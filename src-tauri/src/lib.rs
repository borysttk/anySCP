mod ai;
mod backup;
mod db;
/// External editor detection and launching. The desktop implementation spawns
/// processes and probes `/Applications`, `~/.local/bin` and the Windows
/// registry — none of which exist on Android, where apps cannot run arbitrary
/// executables. The mobile shim keeps `EditorConfig` and `detect_editors`
/// available so dependent command signatures still resolve.
#[cfg(not(target_os = "android"))]
mod editors;
#[cfg(target_os = "android")]
#[path = "editors/mobile.rs"]
mod editors;

/// `~/.ssh/config` import. The desktop implementation depends on
/// `ssh2-config`, whose build script pulls in git2 → openssl-sys; Android has
/// no user SSH config to read either.
#[cfg(not(target_os = "android"))]
mod import;
#[cfg(target_os = "android")]
#[path = "import/mobile.rs"]
mod import;

mod platform;
mod portforward;
mod s3;
mod scp;
mod sftp;
mod snippets;
mod ssh;
pub mod telemetry;
pub mod transfer_common;
mod types;
mod vault;

use db::HostDb;
use portforward::manager::PortForwardManager;
use s3::transfer_manager::S3TransferManager;
use s3::S3Manager;
use scp::transfer_manager::ScpTransferManager;
use scp::ScpManager;
use sftp::transfer_manager::TransferManager;
use sftp::SftpManager;
use ssh::manager::SshManager;
use std::sync::Arc;
use tauri::Manager;
// Only the desktop branch builds a window; importing these on Android would
// trip the unused-import lint.
#[cfg(not(target_os = "android"))]
use tauri::{WebviewUrl, WebviewWindowBuilder};

/// Whether this is a real release build — i.e. a packaged binary that can
/// safely self-update via the updater plugin.
///
/// False for `tauri dev` and `tauri build --debug` (the E2E binary). Those
/// builds must never download + install a release over themselves: it
/// overwrites the running executable and corrupts it (the E2E suite would
/// otherwise fail with "Permission denied" launching the binary mid-run).
/// `debug_assertions` is the correct discriminator — it is off only for an
/// actual `--release` build.
#[tauri::command]
fn is_release_build() -> bool {
    !cfg!(debug_assertions)
}

/// Install the tracing subscriber for the current platform.
///
/// Android discards stdout/stderr from native code, so the default `fmt()`
/// writer would silently produce nothing in `adb logcat`. Route through the
/// logd socket instead, keeping the same env filter on both platforms.
fn init_tracing() {
    const FILTER: &str = "anyscp=debug,russh=info";

    #[cfg(target_os = "android")]
    {
        use tracing_logcat::{LogcatMakeWriter, LogcatTag};
        use tracing_subscriber::fmt::format::Format;

        let Ok(writer) = LogcatMakeWriter::new(LogcatTag::Fixed("anySCP".to_owned())) else {
            // logd is unreachable (very unusual); a logging failure must never
            // prevent the app from starting.
            return;
        };

        tracing_subscriber::fmt()
            // logcat records its own timestamp and level, so omit both here to
            // avoid duplicated columns in every line.
            .event_format(Format::default().with_level(false).without_time())
            .with_writer(writer)
            .with_ansi(false)
            .with_env_filter(FILTER)
            .init();
    }

    #[cfg(not(target_os = "android"))]
    tracing_subscriber::fmt().with_env_filter(FILTER).init();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    init_tracing();

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init());

    // The updater and process plugins have no Android/iOS implementation, and
    // Google Play forbids apps from installing their own updates. Registering
    // them on mobile would fail at startup.
    #[cfg(not(target_os = "android"))]
    let builder = builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init());

    builder
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .map_err(|e| format!("could not resolve app data dir: {e}"))?;

            // Seed the scratch root before anything can use it. On Android
            // `std::env::temp_dir()` resolves to /tmp, which does not exist in
            // the app sandbox, so backup export/restore and the SFTP staging
            // paths must go through the app cache dir instead.
            if let Ok(cache_dir) = app.path().app_cache_dir() {
                platform::init_cache_root(cache_dir);
            }

            let host_db = HostDb::new(&app_data_dir)
                .map_err(|e| format!("failed to initialise database: {e}"))?;

            // Resolve the persisted theme up-front and inject it onto <html>
            // *before* the page loads, so the very first paint already carries
            // the correct theme — no dark→light flash on startup. SQLite stays
            // the single source of truth; the frontend store seeds itself from
            // this attribute (see settings-store.ts). The window is created here
            // (rather than declaratively in tauri.conf.json) specifically so we
            // can attach this initialization script before first paint.
            let theme = match host_db.get_setting("app_theme") {
                Ok(Some(v)) if v == "light" => "light",
                _ => "dark",
            };
            // Same rationale as the theme: inject the persisted accent hue before
            // first paint so the accent colour doesn't flash from the default.
            let accent_hue: f64 = host_db
                .get_setting("app_accent_hue")
                .ok()
                .flatten()
                .and_then(|v| v.parse().ok())
                .unwrap_or(250.0);

            // Optional full custom accent stored as oklch "l c h"; when present it
            // overrides the hue-based tokens (supports gray / darker shades). Inject
            // it before first paint too, so a custom accent doesn't flash.
            let custom_accent_script = host_db
                .get_setting("app_accent_custom")
                .ok()
                .flatten()
                .and_then(|v| {
                    let parts: Vec<f64> =
                        v.split_whitespace().filter_map(|x| x.parse().ok()).collect();
                    if parts.len() == 3 {
                        let (l, c, h) = (parts[0], parts[1], parts[2]);
                        let hover = (l - 0.05).max(0.0);
                        Some(format!(
                            "var s=document.documentElement.style;\
                             s.setProperty('--color-accent','oklch({l} {c} {h})');\
                             s.setProperty('--color-accent-hover','oklch({hover} {c} {h})');\
                             s.setProperty('--color-accent-muted','oklch({l} {c} {h} / 0.15)');\
                             s.setProperty('--color-border-focus','oklch({l} {c} {h})');\
                             s.setProperty('--color-ring','oklch({l} {c} {h} / 0.40)');\
                             document.documentElement.dataset.accentCustom='{l} {c} {h}';"
                        ))
                    } else {
                        None
                    }
                })
                .unwrap_or_default();

            // Optional interface (UI) font; inject before first paint too.
            let font_script = match host_db.get_setting("app_interface_font") {
                Ok(Some(f)) if !f.is_empty() => format!(
                    "document.documentElement.style.setProperty('--font-sans', {f:?});document.documentElement.dataset.interfaceFont={f:?};"
                ),
                _ => String::new(),
            };

            // Interface monospace font: same pre-paint treatment, else every
            // font-mono surface flashes the default until settings load.
            let mono_font_script = match host_db.get_setting("app_interface_mono_font") {
                Ok(Some(f)) if !f.is_empty() => format!(
                    "document.documentElement.style.setProperty('--font-mono', {f:?});document.documentElement.dataset.interfaceMonoFont={f:?};"
                ),
                _ => String::new(),
            };

            let theme_script = format!(
                "document.documentElement.dataset.theme = {theme:?}; document.documentElement.style.setProperty('--accent-hue', '{accent_hue}');{custom_accent_script}{font_script}{mono_font_script}"
            );

            // Desktop creates its own window so the theme script can be attached
            // before first paint. On Android the webview belongs to the Activity
            // and is created by the Tauri runtime before `setup` runs, so the
            // same script is injected into the existing window instead.
            #[cfg(not(target_os = "android"))]
            WebviewWindowBuilder::new(app.handle(), "main", WebviewUrl::App("index.html".into()))
                .title("anySCP")
                .inner_size(1200.0, 800.0)
                .min_inner_size(800.0, 500.0)
                .initialization_script(&theme_script)
                .build()
                .map_err(|e| format!("failed to create main window: {e}"))?;

            // The Android webview has already navigated by this point, so an
            // initialization script would not run until the next load. Evaluate
            // it directly; a brief flash of the default theme is possible on the
            // very first frame, which is addressed in the mobile UI phase.
            #[cfg(target_os = "android")]
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.eval(&theme_script);
            }

            app.manage(Arc::new(host_db));

            // SftpManager must be created inside setup so it can be shared with
            // TransferManager, which also needs the AppHandle.
            let sftp_manager = Arc::new(SftpManager::new());
            let transfer_manager = Arc::new(TransferManager::new(
                sftp_manager.clone(),
                app.handle().clone(),
            ));
            app.manage(sftp_manager);
            app.manage(transfer_manager);

            // SCP shares the SSH connection but tracks its own sessions and
            // transfer queue, mirroring the SFTP managers.
            let scp_manager = Arc::new(ScpManager::new());
            let scp_transfer_manager = Arc::new(ScpTransferManager::new(
                scp_manager.clone(),
                app.handle().clone(),
            ));
            app.manage(scp_manager);
            app.manage(scp_transfer_manager);

            let pf_manager = Arc::new(PortForwardManager::new(app.handle().clone()));
            app.manage(pf_manager);

            let s3_manager = Arc::new(S3Manager::new());
            let s3_transfer_manager = Arc::new(S3TransferManager::new(
                s3_manager.clone(),
                app.handle().clone(),
            ));
            app.manage(s3_manager);
            app.manage(s3_transfer_manager);

            telemetry::init();

            Ok(())
        })
        .manage(SshManager::new())
        .invoke_handler(tauri::generate_handler![
            // SFTP — session & filesystem
            sftp::commands::sftp_open,
            sftp::commands::sftp_close,
            sftp::commands::sftp_list_dir,
            sftp::commands::sftp_home_dir,
            sftp::commands::sftp_mkdir,
            sftp::commands::sftp_create_file,
            sftp::commands::sftp_delete,
            sftp::commands::sftp_rename,
            sftp::commands::sftp_chmod,
            sftp::commands::sftp_chmod_recursive,
            // SFTP — copy / move
            sftp::commands::sftp_move_entries,
            sftp::commands::sftp_copy_entries,
            // SFTP — legacy direct transfers (kept for VS Code edit workflow)
            sftp::commands::sftp_download,
            sftp::commands::sftp_drag_out,
            sftp::commands::sftp_upload,
            sftp::commands::sftp_cancel_transfer,
            sftp::commands::sftp_edit_external,
            // SFTP — queue-based Transfer Manager
            sftp::commands::sftp_enqueue_upload,
            sftp::commands::sftp_enqueue_download,
            sftp::commands::sftp_retry_transfer,
            sftp::commands::sftp_list_transfers,
            sftp::commands::sftp_clear_finished_transfers,
            sftp::commands::sftp_set_concurrency,
            // SCP — session & filesystem (mirrors SFTP; used as a fallback
            // when the remote has the SFTP subsystem disabled)
            scp::commands::scp_open,
            scp::commands::scp_close,
            scp::commands::scp_list_dir,
            scp::commands::scp_home_dir,
            scp::commands::scp_mkdir,
            scp::commands::scp_create_file,
            scp::commands::scp_delete,
            scp::commands::scp_rename,
            scp::commands::scp_chmod,
            scp::commands::scp_chmod_recursive,
            // SCP — copy / move
            scp::commands::scp_move_entries,
            scp::commands::scp_copy_entries,
            // SCP — direct transfers (edit-in-vscode workflow)
            scp::commands::scp_download,
            scp::commands::scp_upload,
            scp::commands::scp_cancel_transfer,
            scp::commands::scp_edit_external,
            // SCP — queue-based Transfer Manager
            scp::commands::scp_enqueue_upload,
            scp::commands::scp_enqueue_download,
            scp::commands::scp_retry_transfer,
            scp::commands::scp_list_transfers,
            scp::commands::scp_clear_finished_transfers,
            scp::commands::scp_set_concurrency,
            // SSH
            ssh::commands::ssh_connect,
            ssh::commands::ssh_cancel_connect,
            ssh::commands::ssh_split_session,
            ssh::commands::ssh_disconnect,
            ssh::commands::ssh_send_input,
            ssh::commands::ssh_resize_pty,
            ssh::commands::list_ssh_keys,
            ssh::commands::inspect_ssh_key,
            ssh::commands::ssh_health_check_saved_host,
            ssh::commands::connect_saved_host,
            ssh::commands::connect_saved_host_no_pty,
            // Host persistence
            db::commands::save_host,
            db::commands::list_hosts,
            db::commands::delete_host,
            db::commands::reorder_hosts,
            db::commands::get_host,
            // Host groups
            db::commands::create_group,
            db::commands::update_group,
            db::commands::list_groups,
            db::commands::reorder_groups,
            db::commands::delete_group,
            db::commands::delete_group_with_hosts,
            // Connection history
            db::commands::record_connection,
            db::commands::list_recent_connections,
            // Connection history (full audit)
            db::commands::list_connection_history,
            db::commands::delete_connection_history_entry,
            // App settings
            db::commands::save_setting,
            db::commands::load_all_settings,
            // Factory reset (wipe all data + credentials)
            db::commands::factory_reset,
            // Encrypted backup / restore
            backup::commands::backup_export,
            backup::commands::backup_import,
            // External editors
            editors::detect_editors,
            // Credential vault
            vault::vault_save_credential,
            vault::vault_delete_credential,
            vault::vault_has_credential,
            // S3
            s3::commands::s3_connect,
            s3::commands::s3_disconnect,
            s3::commands::s3_list_buckets,
            s3::commands::s3_switch_bucket,
            s3::commands::s3_list_objects,
            s3::commands::s3_delete_object,
            s3::commands::s3_delete_objects,
            s3::commands::s3_create_folder,
            s3::commands::s3_presign_url,
            s3::commands::s3_head_object,
            s3::commands::s3_upload_file,
            s3::commands::s3_download_file,
            s3::commands::s3_save_connection,
            s3::commands::s3_list_connections,
            s3::commands::reorder_s3_connections,
            s3::commands::s3_delete_connection,
            s3::commands::s3_reconnect,
            s3::commands::s3_update_connection,
            s3::commands::s3_create_file,
            s3::commands::s3_upload_files,
            s3::commands::s3_delete_prefix,
            // S3 — Transfer Manager
            s3::commands::s3_enqueue_upload,
            s3::commands::s3_enqueue_download,
            s3::commands::s3_enqueue_download_as,
            s3::commands::s3_cancel_transfer,
            s3::commands::s3_retry_transfer,
            s3::commands::s3_list_transfers,
            s3::commands::s3_clear_finished_transfers,
            s3::commands::s3_edit_external,
            // SSH config import
            import::commands::import_parse_ssh_config,
            import::commands::import_save_ssh_hosts,
            // Port forwarding
            portforward::commands::pf_create_rule,
            portforward::commands::pf_update_rule,
            portforward::commands::pf_delete_rule,
            portforward::commands::pf_list_rules,
            portforward::commands::pf_start_tunnel,
            portforward::commands::pf_stop_tunnel,
            portforward::commands::pf_list_active_tunnels,
            // Snippets
            snippets::commands::save_snippet,
            snippets::commands::get_snippet,
            snippets::commands::list_snippets,
            snippets::commands::delete_snippet,
            snippets::commands::search_snippets,
            snippets::commands::record_snippet_use,
            snippets::commands::save_snippet_folder,
            snippets::commands::list_snippet_folders,
            snippets::commands::delete_snippet_folder,
            snippets::commands::snippet_execute,
            // Build info
            is_release_build,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
