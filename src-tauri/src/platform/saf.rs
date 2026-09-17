//! Storage Access Framework bridge (Android) with desktop no-ops.
//!
//! # Why this is needed
//!
//! Scoped Storage (Android 10 / API 29) blocks writes to absolute public paths
//! such as `/sdcard/Download`. The app can write freely only inside its own
//! sandbox, which the user cannot browse. To deliver a downloaded file
//! somewhere useful the app must ask the system document picker for a
//! destination and write through the returned `content://` URI.
//!
//! # Shape of the bridge
//!
//! The picker is an activity result, i.e. a callback, whereas the transfer code
//! is linear async Rust. [`create_document`] therefore registers a oneshot
//! sender under a request ID, asks Kotlin to launch the picker, and awaits the
//! matching reply that `Java_..._nativeOnSafResult` delivers.
//!
//! Transfers still stage into app-private cache and copy into the SAF URI at
//! the end: streaming directly would leave a truncated document in the user's
//! Downloads folder if the connection dropped mid-transfer.

use std::path::Path;

/// Error cases a SAF round-trip can produce.
#[derive(Debug, thiserror::Error)]
pub enum SafError {
    #[error("SAF is only available on Android")]
    Unsupported,
    #[error("user cancelled the file picker")]
    Cancelled,
    #[error("SAF bridge error: {0}")]
    Bridge(String),
}

#[cfg(not(target_os = "android"))]
mod imp {
    use super::*;

    /// Desktop keeps using real filesystem paths through the dialog plugin, so
    /// nothing should reach this.
    pub async fn create_document(_file_name: &str, _mime_type: &str) -> Result<String, SafError> {
        Err(SafError::Unsupported)
    }

    pub fn copy_to_uri(_staged: &Path, _uri: &str) -> Result<u64, SafError> {
        Err(SafError::Unsupported)
    }
}

#[cfg(target_os = "android")]
mod imp {
    use super::*;
    use jni::objects::{JClass, JObject, JValue};
    use std::collections::HashMap;
    use std::sync::{Mutex, OnceLock};
    use tokio::sync::oneshot;

    /// Pending picker requests, keyed by the request code Kotlin allocated.
    ///
    /// An entry lives only between launching the picker and the activity result
    /// arriving; the receiver side is dropped if the caller gives up, in which
    /// case the send simply fails and the stale entry is pruned here.
    type Pending = Mutex<HashMap<i32, oneshot::Sender<Option<String>>>>;

    fn pending() -> &'static Pending {
        static PENDING: OnceLock<Pending> = OnceLock::new();
        PENDING.get_or_init(|| Mutex::new(HashMap::new()))
    }

    /// Resolve an app class through the Activity's own ClassLoader.
    ///
    /// `JNIEnv::find_class` searches only the system loader, which cannot see
    /// classes shipped in the APK when called from a native thread.
    fn find_app_class<'a>(
        env: &mut jni::JNIEnv<'a>,
        activity: &JObject<'a>,
        name: &str,
    ) -> Result<JObject<'a>, SafError> {
        let loader = env
            .call_method(activity, "getClassLoader", "()Ljava/lang/ClassLoader;", &[])
            .and_then(|v| v.l())
            .map_err(|e| SafError::Bridge(format!("getClassLoader failed: {e}")))?;
        let dotted = env
            .new_string(name.replace('/', "."))
            .map_err(|e| SafError::Bridge(format!("new_string failed: {e}")))?;
        env.call_method(
            loader,
            "loadClass",
            "(Ljava/lang/String;)Ljava/lang/Class;",
            &[JValue::Object(&dotted.into())],
        )
        .and_then(|v| v.l())
        .map_err(|e| SafError::Bridge(format!("loadClass({name}) failed: {e}")))
    }

    /// Run `f` with a JNI env attached to the current thread and the Activity.
    ///
    /// The `for<'a>` bound is load-bearing. Writing the closure type as
    /// `FnOnce(&mut JNIEnv, &JObject)` lets elision give each argument its
    /// *own* lifetime (`&mut JNIEnv<'b>`, `&JObject<'d>`), so a callee such as
    /// `find_app_class<'a>(&mut JNIEnv<'a>, &JObject<'a>)` — which requires the
    /// env and the object to belong to the same local frame — cannot be called
    /// from inside `f`. Naming one lifetime for both is also semantically
    /// correct: the Activity reference lives in the frame `env` owns.
    fn with_activity<T>(
        f: impl for<'a> FnOnce(&mut jni::JNIEnv<'a>, &JObject<'a>) -> Result<T, SafError>,
    ) -> Result<T, SafError> {
        let ctx = ndk_context::android_context();
        let vm = unsafe { jni::JavaVM::from_raw(ctx.vm().cast()) }
            .map_err(|e| SafError::Bridge(format!("JavaVM::from_raw failed: {e}")))?;
        let activity = unsafe { JObject::from_raw(ctx.context().cast()) };
        let mut env = vm
            .attach_current_thread()
            .map_err(|e| SafError::Bridge(format!("attach_current_thread failed: {e}")))?;
        f(&mut env, &activity)
    }

    /// Ask the user where to save `file_name`; resolves to a `content://` URI.
    pub async fn create_document(file_name: &str, mime_type: &str) -> Result<String, SafError> {
        let (tx, rx) = oneshot::channel();

        let request_id = with_activity(|env, activity| {
            let class = find_app_class(env, activity, "com.macnev2013.anyscp.SafBridge")?;
            let j_name = env
                .new_string(file_name)
                .map_err(|e| SafError::Bridge(format!("new_string failed: {e}")))?;
            let j_mime = env
                .new_string(mime_type)
                .map_err(|e| SafError::Bridge(format!("new_string failed: {e}")))?;
            env.call_static_method(
                JClass::from(class),
                "requestCreateDocument",
                "(Landroid/app/Activity;Ljava/lang/String;Ljava/lang/String;)I",
                &[
                    JValue::Object(activity),
                    JValue::Object(&j_name.into()),
                    JValue::Object(&j_mime.into()),
                ],
            )
            .and_then(|v| v.i())
            .map_err(|e| SafError::Bridge(format!("requestCreateDocument failed: {e}")))
        })?;

        // Register only after the picker launched, so a failed launch cannot
        // leave an orphan entry behind.
        pending()
            .lock()
            .expect("SAF pending map poisoned")
            .insert(request_id, tx);

        match rx.await {
            Ok(Some(uri)) => Ok(uri),
            Ok(None) => Err(SafError::Cancelled),
            // The sender was dropped — the activity was destroyed before the
            // result came back.
            Err(_) => Err(SafError::Bridge("picker result never arrived".into())),
        }
    }

    /// Copy a staged file into the SAF destination, deleting the staged copy.
    pub fn copy_to_uri(staged: &Path, uri: &str) -> Result<u64, SafError> {
        let staged = staged.to_string_lossy().to_string();
        with_activity(|env, activity| {
            let class = find_app_class(env, activity, "com.macnev2013.anyscp.SafBridge")?;
            let j_src = env
                .new_string(&staged)
                .map_err(|e| SafError::Bridge(format!("new_string failed: {e}")))?;
            let j_uri = env
                .new_string(uri)
                .map_err(|e| SafError::Bridge(format!("new_string failed: {e}")))?;
            let written = env
                .call_static_method(
                    JClass::from(class),
                    "copyFileToUri",
                    "(Landroid/app/Activity;Ljava/lang/String;Ljava/lang/String;)J",
                    &[
                        JValue::Object(activity),
                        JValue::Object(&j_src.into()),
                        JValue::Object(&j_uri.into()),
                    ],
                )
                .and_then(|v| v.j())
                .map_err(|e| SafError::Bridge(format!("copyFileToUri failed: {e}")))?;
            if written < 0 {
                return Err(SafError::Bridge("copy to content URI failed".into()));
            }
            Ok(written as u64)
        })
    }

    /// Activity result callback from `SafBridge.handleActivityResult`.
    #[no_mangle]
    pub extern "system" fn Java_com_macnev2013_anyscp_SafBridge_nativeOnSafResult(
        mut env: jni::JNIEnv,
        _class: jni::objects::JClass,
        request_code: jni::sys::jint,
        uri: jni::objects::JString,
    ) {
        let uri: Option<String> = if uri.is_null() {
            None
        } else {
            env.get_string(&uri).ok().map(|s| s.into())
        };

        if let Some(tx) = pending()
            .lock()
            .expect("SAF pending map poisoned")
            .remove(&request_code)
        {
            // Failure means the awaiting task is gone; nothing to do.
            let _ = tx.send(uri);
        }
    }
}

pub use imp::{copy_to_uri, create_document};

/// Best-effort MIME type from a file extension.
///
/// Only the handful of types worth distinguishing in a picker are listed; the
/// fallback is always safe, since SAF treats `application/octet-stream` as an
/// opaque binary and still lets the user choose any destination.
pub fn mime_for(file_name: &str) -> &'static str {
    let ext = Path::new(file_name)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();

    match ext.as_str() {
        "txt" | "log" | "md" | "conf" | "cfg" | "ini" | "yaml" | "yml" | "toml" => "text/plain",
        "json" => "application/json",
        "xml" => "text/xml",
        "csv" => "text/csv",
        "html" | "htm" => "text/html",
        "pdf" => "application/pdf",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "mp4" => "video/mp4",
        "mp3" => "audio/mpeg",
        "zip" => "application/zip",
        "gz" | "tgz" => "application/gzip",
        "tar" => "application/x-tar",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_extensions_map_to_types() {
        assert_eq!(mime_for("notes.txt"), "text/plain");
        assert_eq!(mime_for("data.json"), "application/json");
        assert_eq!(mime_for("photo.JPG"), "image/jpeg", "must be case-insensitive");
        assert_eq!(mime_for("archive.tar"), "application/x-tar");
    }

    /// Unknown and extension-less names must still produce a usable type —
    /// remote files frequently have no extension at all.
    #[test]
    fn unknown_extensions_fall_back_to_octet_stream() {
        assert_eq!(mime_for("id_rsa"), "application/octet-stream");
        assert_eq!(mime_for("core.12345"), "application/octet-stream");
        assert_eq!(mime_for(""), "application/octet-stream");
    }

    /// A dotfile's leading dot is not an extension.
    #[test]
    fn dotfiles_are_not_treated_as_extensions() {
        assert_eq!(mime_for(".bashrc"), "application/octet-stream");
    }
}
