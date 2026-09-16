//! Platform abstraction layer for the Android port.
//!
//! anySCP targets desktop (macOS / Windows / Linux) and Android from a single
//! Rust tree. Rather than forking, every platform difference is funnelled
//! through this module so the divergence stays auditable in one place.
//!
//! Two concerns live here:
//!
//! 1. **Scratch storage** — `std::env::temp_dir()` resolves to `/tmp` on
//!    Android, which does not exist and is not writable in the app sandbox.
//!    Callers use [`temp_root`] instead, which is seeded at startup from
//!    Tauri's `app_cache_dir()` (`/data/data/<pkg>/cache`).
//!
//! 2. **Unsupported features** — desktop-only commands stay registered in the
//!    IPC handler on mobile and return [`unsupported`] instead of vanishing.
//!    A missing command surfaces to the webview as an opaque
//!    "command not found" string; an explicit error carries a message the UI
//!    can show the user.

pub mod foreground;

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

/// Process-wide scratch root, seeded once during `setup()`.
///
/// A `OnceLock` rather than an `AppHandle` parameter because the call sites
/// ([`crate::db::HostDb`] snapshot export/restore) are synchronous helpers
/// several layers below any Tauri state, and threading a handle through them
/// would touch far more code than this port needs to.
static CACHE_ROOT: OnceLock<PathBuf> = OnceLock::new();

/// Seed the scratch root. Call once, early in `setup()`, before any code path
/// that can reach [`temp_root`].
///
/// Later calls are ignored — the first writer wins, which keeps the value
/// stable for the lifetime of the process.
pub fn init_cache_root(dir: PathBuf) {
    let _ = CACHE_ROOT.set(dir);
}

/// Directory for short-lived scratch files.
///
/// Returns the seeded cache dir when available, otherwise `std::env::temp_dir()`.
/// The fallback keeps unit tests working: they exercise `HostDb` directly
/// without a Tauri app, so `init_cache_root` never runs.
///
/// On Android the fallback would be wrong (`/tmp`), but Android always runs
/// through `setup()`, so it is only ever reached on desktop and in tests.
pub fn temp_root() -> PathBuf {
    CACHE_ROOT
        .get()
        .cloned()
        .unwrap_or_else(std::env::temp_dir)
}

/// Create an owner-only (0700 on Unix) scratch directory under [`temp_root`].
///
/// Used for plaintext SQLite snapshots during backup export/restore, which
/// must not be world-readable even for the moment they exist.
pub fn private_scratch_dir(prefix: &str) -> std::io::Result<PathBuf> {
    let dir = temp_root().join(format!("{prefix}-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir)?;
    set_private_permissions(&dir)?;
    Ok(dir)
}

/// Restrict a path to owner-only access (no-op on non-Unix).
pub fn set_private_permissions(path: &Path) -> std::io::Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700))?;
    }
    #[cfg(not(unix))]
    {
        let _ = path;
    }
    Ok(())
}

/// `true` when compiled for a mobile target.
///
/// Prefer `#[cfg(mobile)]` where the *code* differs; use this where only a
/// runtime value differs and duplicating a function would be noise.
pub const fn is_mobile() -> bool {
    cfg!(mobile)
}

/// Standard message for a desktop-only command invoked on mobile.
///
/// Kept as one function so the wording — and therefore the string the
/// frontend matches on — cannot drift between call sites.
pub fn unsupported(feature: &str) -> String {
    format!("{feature} is not available on this platform")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn temp_root_falls_back_to_env_temp_dir_when_unseeded() {
        // CACHE_ROOT may have been seeded by another test in this binary, so
        // assert the weaker invariant that always holds: a usable directory.
        let root = temp_root();
        assert!(root.is_absolute(), "temp root must be absolute: {root:?}");
    }

    #[test]
    fn private_scratch_dir_is_unique_per_call() {
        let a = private_scratch_dir("anyscp-test-scratch").expect("first");
        let b = private_scratch_dir("anyscp-test-scratch").expect("second");
        assert_ne!(a, b, "scratch dirs must not collide");
        assert!(a.is_dir() && b.is_dir());
        let _ = std::fs::remove_dir_all(&a);
        let _ = std::fs::remove_dir_all(&b);
    }

    #[cfg(unix)]
    #[test]
    fn private_scratch_dir_is_owner_only() {
        use std::os::unix::fs::PermissionsExt;
        let dir = private_scratch_dir("anyscp-test-perms").expect("create");
        let mode = std::fs::metadata(&dir).expect("stat").permissions().mode();
        assert_eq!(mode & 0o777, 0o700, "scratch dir must be 0700");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn unsupported_message_names_the_feature() {
        assert!(unsupported("Drag-out").contains("Drag-out"));
    }
}
