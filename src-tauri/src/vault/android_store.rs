//! Android credential store — EncryptedSharedPreferences via JNI.
//!
//! The `keyring` crate has no Android backend (it covers Linux, FreeBSD,
//! OpenBSD, Windows, macOS and iOS), so the vault is bridged to a small Kotlin
//! helper, `com.macnev2013.anyscp.SecureStore`, which wraps AndroidX Security's
//! `EncryptedSharedPreferences`. The AES master key lives in the hardware-backed
//! Android Keystore and never enters the Rust address space; only the decrypted
//! JSON payload crosses the JNI boundary, matching how the desktop keychain
//! backends behave.
//!
//! ## Why a Kotlin helper rather than pure JNI
//!
//! `EncryptedSharedPreferences` is constructed through a builder with several
//! Keystore parameters. Driving that entirely from `jni` calls would be dozens
//! of fragile reflective invocations; a ~40-line Kotlin file with four static
//! methods is far easier to review and to keep correct.
//!
//! ## Thread and class-loader handling
//!
//! Tauri commands run on Tokio worker threads, which the JVM has never seen, so
//! every call attaches the thread first. More subtly, `FindClass` on a natively
//! attached thread searches only the *bootstrap* class loader and therefore
//! cannot see application classes — the classic "ClassNotFoundException from a
//! native thread" trap. We resolve `SecureStore` once through the Activity's
//! own class loader and cache it as a global reference.

use super::{StoredCredential, VaultError, SERVICE_NAME};
use jni::objects::{GlobalRef, JObject, JString, JValue};
use jni::{JNIEnv, JavaVM};
use std::sync::OnceLock;
use tracing::instrument;

/// Fully-qualified name of the Kotlin helper, as the class loader expects it
/// (dots, not slashes — `loadClass` takes a binary name).
const HELPER_CLASS: &str = "com.macnev2013.anyscp.SecureStore";

/// Cached global reference to the resolved `SecureStore` class.
static HELPER: OnceLock<GlobalRef> = OnceLock::new();

fn jni_err(context: &str, e: impl std::fmt::Display) -> VaultError {
    VaultError::Keychain(format!("{context}: {e}"))
}

/// Obtain the process `JavaVM` from the NDK context that Tauri's Android
/// runtime (`tao`) initialises during startup.
fn java_vm() -> Result<JavaVM, VaultError> {
    let ctx = ndk_context::android_context();
    // SAFETY: `tao` initialises the NDK context with a valid JavaVM pointer
    // before any Tauri command can run, and the pointer is valid for the
    // lifetime of the process.
    unsafe { JavaVM::from_raw(ctx.vm().cast()) }
        .map_err(|e| jni_err("could not obtain JavaVM", e))
}

/// Resolve `SecureStore` through the Activity's class loader and cache it.
fn helper_class(env: &mut JNIEnv) -> Result<GlobalRef, VaultError> {
    if let Some(cached) = HELPER.get() {
        return Ok(cached.clone());
    }

    let ctx = ndk_context::android_context();
    // SAFETY: as above — the NDK context holds a valid Activity/Context ref.
    let activity = unsafe { JObject::from_raw(ctx.context().cast()) };

    let loader = env
        .call_method(
            &activity,
            "getClassLoader",
            "()Ljava/lang/ClassLoader;",
            &[],
        )
        .and_then(|v| v.l())
        .map_err(|e| jni_err("getClassLoader failed", e))?;

    let name: JString = env
        .new_string(HELPER_CLASS)
        .map_err(|e| jni_err("could not allocate class name", e))?;

    let class = env
        .call_method(
            &loader,
            "loadClass",
            "(Ljava/lang/String;)Ljava/lang/Class;",
            &[JValue::Object(&name)],
        )
        .and_then(|v| v.l())
        .map_err(|e| jni_err(&format!("could not load {HELPER_CLASS}"), e))?;

    let global = env
        .new_global_ref(class)
        .map_err(|e| jni_err("could not pin class reference", e))?;

    // Another thread may have raced us; either reference is equally valid.
    let _ = HELPER.set(global.clone());
    Ok(global)
}

/// Run `f` with an attached JNI environment and the resolved helper class.
///
/// Any pending Java exception is cleared and converted into a `VaultError`,
/// because leaving one pending would abort the process on the next JNI call.
fn with_helper<T>(
    f: impl FnOnce(&mut JNIEnv, &GlobalRef) -> Result<T, VaultError>,
) -> Result<T, VaultError> {
    let vm = java_vm()?;
    let mut env = vm
        .attach_current_thread()
        .map_err(|e| jni_err("could not attach thread to JVM", e))?;

    let class = helper_class(&mut env)?;
    let result = f(&mut env, &class);

    if env.exception_check().unwrap_or(false) {
        let _ = env.exception_describe();
        let _ = env.exception_clear();
        return Err(VaultError::Keychain(
            "the Android keystore raised an exception".to_string(),
        ));
    }

    result
}

/// Build the storage key. Namespacing by service keeps the layout identical in
/// spirit to the desktop `(service, user)` pair.
fn storage_key(host_id: &str) -> String {
    format!("{SERVICE_NAME}:{host_id}")
}

#[instrument(skip(credential), fields(host_id = %host_id))]
pub fn save_credential(host_id: &str, credential: &StoredCredential) -> Result<(), VaultError> {
    let json =
        serde_json::to_string(credential).map_err(|e| VaultError::InvalidData(e.to_string()))?;
    let key = storage_key(host_id);

    with_helper(|env, class| {
        let j_key = env
            .new_string(&key)
            .map_err(|e| jni_err("alloc key", e))?;
        let j_val = env
            .new_string(&json)
            .map_err(|e| jni_err("alloc value", e))?;

        env.call_static_method(
            class,
            "save",
            "(Ljava/lang/String;Ljava/lang/String;)V",
            &[JValue::Object(&j_key), JValue::Object(&j_val)],
        )
        .map_err(|e| jni_err("SecureStore.save failed", e))?;
        Ok(())
    })?;

    tracing::debug!(host_id = %host_id, "credential saved to Android keystore");
    Ok(())
}

#[instrument(fields(host_id = %host_id))]
pub fn get_credential(host_id: &str) -> Result<StoredCredential, VaultError> {
    let key = storage_key(host_id);

    let json: Option<String> = with_helper(|env, class| {
        let j_key = env
            .new_string(&key)
            .map_err(|e| jni_err("alloc key", e))?;

        let value = env
            .call_static_method(
                class,
                "load",
                "(Ljava/lang/String;)Ljava/lang/String;",
                &[JValue::Object(&j_key)],
            )
            .and_then(|v| v.l())
            .map_err(|e| jni_err("SecureStore.load failed", e))?;

        if value.is_null() {
            return Ok(None);
        }

        let s: String = env
            .get_string(&JString::from(value))
            .map_err(|e| jni_err("could not read returned string", e))?
            .into();
        Ok(Some(s))
    })?;

    let json = json.ok_or_else(|| VaultError::NotFound(host_id.to_string()))?;
    serde_json::from_str(&json).map_err(|e| VaultError::InvalidData(e.to_string()))
}

/// Delete the credential. A missing entry is success, matching desktop.
#[instrument(fields(host_id = %host_id))]
pub fn delete_credential(host_id: &str) -> Result<(), VaultError> {
    let key = storage_key(host_id);

    with_helper(|env, class| {
        let j_key = env
            .new_string(&key)
            .map_err(|e| jni_err("alloc key", e))?;

        env.call_static_method(
            class,
            "delete",
            "(Ljava/lang/String;)V",
            &[JValue::Object(&j_key)],
        )
        .map_err(|e| jni_err("SecureStore.delete failed", e))?;
        Ok(())
    })?;

    tracing::debug!(host_id = %host_id, "credential deleted from Android keystore");
    Ok(())
}

/// Return `true` when a credential exists, without decrypting it.
///
/// Mirrors the desktop contract: a backend failure reports "absent" rather
/// than propagating, since callers use this only to drive UI affordances.
pub fn has_credential(host_id: &str) -> bool {
    let key = storage_key(host_id);

    with_helper(|env, class| {
        let j_key = env
            .new_string(&key)
            .map_err(|e| jni_err("alloc key", e))?;

        env.call_static_method(
            class,
            "contains",
            "(Ljava/lang/String;)Z",
            &[JValue::Object(&j_key)],
        )
        .and_then(|v| v.z())
        .map_err(|e| jni_err("SecureStore.contains failed", e))
    })
    .unwrap_or(false)
}
