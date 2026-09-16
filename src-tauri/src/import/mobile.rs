//! Android shim for the `~/.ssh/config` import module.
//!
//! The desktop implementation parses OpenSSH config files with `ssh2-config`,
//! whose build script depends on git2 → libgit2-sys → openssl-sys + libssh2-sys.
//! Those are C libraries that would each need cross-compiling for four Android
//! ABIs, and the feature has no meaning on Android anyway: the app sandbox has
//! no `~/.ssh/config` to read.
//!
//! The two commands stay registered and return a descriptive error, so the
//! frontend surfaces a real message rather than "command not found". The DTOs
//! are preserved so the TypeScript bindings remain identical across platforms.
//!
//! A future "paste your SSH config" flow could parse supplied text on-device;
//! that would live here and would not need the git2 dependency.

use serde::{Deserialize, Serialize};

use crate::db::DbError;
use crate::types::SshError;

// ─── Types (kept in sync with the desktop module) ────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshConfigEntry {
    pub host_alias: String,
    pub hostname: Option<String>,
    pub user: Option<String>,
    pub port: Option<u16>,
    pub identity_file: Option<String>,
    pub proxy_jump: Option<String>,
    pub keep_alive_interval: Option<u32>,
    pub is_pattern: bool,
    pub already_exists: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshConfigImportEntry {
    pub host_alias: String,
    pub hostname: String,
    pub user: String,
    pub port: u16,
    pub identity_file: Option<String>,
    pub proxy_jump: Option<String>,
    pub keep_alive_interval: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportResult {
    pub imported: u32,
    pub skipped: u32,
    pub errors: Vec<String>,
}

// ─── Commands ────────────────────────────────────────────────────────────────

/// Command shims. Namespaced as `import::commands::*` to match the desktop
/// module path used by the `invoke_handler!` registration in `lib.rs`.
pub mod commands {
    use super::*;

    #[tauri::command]
    pub async fn import_parse_ssh_config(
        _path: Option<String>,
    ) -> Result<Vec<SshConfigEntry>, SshError> {
        Err(SshError::IoError(crate::platform::unsupported(
            "Importing ~/.ssh/config",
        )))
    }

    #[tauri::command]
    pub async fn import_save_ssh_hosts(
        _entries: Vec<SshConfigImportEntry>,
    ) -> Result<ImportResult, DbError> {
        Err(DbError::Validation(crate::platform::unsupported(
            "Importing ~/.ssh/config",
        )))
    }
}
