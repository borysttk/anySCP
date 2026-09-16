//! Android shim for the external-editor module.
//!
//! The desktop implementation detects installed editors (VS Code, Sublime,
//! JetBrains…) and launches them on a staged temp file, watching it for
//! changes to re-upload. None of that is possible on Android: apps cannot
//! enumerate or spawn arbitrary executables, and there is no shared filesystem
//! for another app to write back into.
//!
//! Rather than deleting the module and every reference to it, this shim keeps
//! the same public surface. [`EditorConfig`] still exists — it appears in the
//! signatures of `sftp_edit_external`, `scp_edit_external` and
//! `s3_edit_external`, all of which stay registered so the frontend gets a
//! descriptive error instead of an opaque "command not found".

use serde::{Deserialize, Serialize};

/// An external editor. Mirrors the desktop struct field-for-field so the same
/// JSON payloads deserialise identically on both platforms.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EditorConfig {
    pub name: String,
    pub exec_path: String,
    #[serde(default = "default_args")]
    pub args: String,
}

fn default_args() -> String {
    "{path}".to_string()
}

/// No editors are ever detected on Android.
///
/// Returning an empty list (rather than an error) lets the Settings screen
/// render its normal "no editors found" empty state without special-casing.
#[tauri::command]
pub fn detect_editors() -> Vec<EditorConfig> {
    Vec::new()
}
