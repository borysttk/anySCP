//! Android activity lifecycle → Rust bridge.
//!
//! Android freezes the process when the activity goes to the background and
//! silently kills TCP sockets while it is frozen. The peer never learns about
//! it, so a session can look perfectly healthy in our data structures while the
//! transport underneath is dead — writes simply vanish.
//!
//! Detecting this from the webview is unreliable: the OS can freeze the JS
//! event loop before `visibilitychange` / `tauri://focus` is delivered, and
//! some OEM ROMs never deliver it at all. The activity callbacks, by contrast,
//! are guaranteed by the platform. `MainActivity` therefore overrides
//! `onResume`/`onPause` and calls straight into the functions below, so the
//! health sweep starts before the frontend has even regained focus.

use std::sync::OnceLock;
use tauri::AppHandle;

/// Set once during `setup()`. The JNI callbacks arrive on the Android main
/// thread with no access to Tauri state, so the handle has to be parked
/// somewhere global for them to find it.
static APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();

/// Register the app handle used by the lifecycle callbacks.
///
/// Called from `setup()` on every platform — on desktop nothing ever invokes
/// the callbacks, but keeping the call unconditional avoids a second cfg split
/// in `lib.rs`.
pub fn init(app: AppHandle) {
    let _ = APP_HANDLE.set(app);
}

/// The activity came back to the foreground.
///
/// Kicks off an asynchronous liveness sweep of every SSH session. Deliberately
/// does not block: this runs on the Android main thread, and stalling it would
/// freeze the UI (and risk an ANR) for as long as the probes take.
pub fn on_resume() {
    let Some(app) = APP_HANDLE.get() else {
        // Lifecycle callback before setup finished — nothing is connected yet.
        return;
    };
    tracing::info!("activity resumed — starting session health sweep");

    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        crate::ssh::reconnect::resume_sweep(app).await;
    });
}

/// The activity is going to the background.
///
/// Recorded for diagnostics only. Tearing sessions down here would be wrong:
/// a foreground service keeps transfers running, and a brief pause (e.g. the
/// notification shade) must not kill a working connection.
pub fn on_pause() {
    tracing::info!("activity paused");
}

/// JNI entry points. The names encode the Java class that declares the
/// corresponding `external fun`, so they must stay in sync with
/// `com.macnev2013.anyscp.MainActivity` — see `src-tauri/android/MainActivity.kt`.
#[cfg(target_os = "android")]
mod jni_bindings {
    use jni::objects::JClass;
    use jni::JNIEnv;

    #[no_mangle]
    pub extern "system" fn Java_com_macnev2013_anyscp_MainActivity_nativeOnResume(
        _env: JNIEnv,
        _class: JClass,
    ) {
        super::on_resume();
    }

    #[no_mangle]
    pub extern "system" fn Java_com_macnev2013_anyscp_MainActivity_nativeOnPause(
        _env: JNIEnv,
        _class: JClass,
    ) {
        super::on_pause();
    }
}
