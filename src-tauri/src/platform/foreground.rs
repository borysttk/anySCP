//! Foreground-service control for background transfers on Android.
//!
//! Android freezes the app process shortly after the activity stops, which
//! stalls in-flight SFTP transfers. Promoting the process to a foreground
//! service with an ongoing notification is the only supported way to keep the
//! work running (see `src-tauri/android/TransferService.kt`).
//!
//! The service is reference-counted against the number of active transfers:
//! started when the count goes 0 → 1, stopped when it returns to 0. That keeps
//! the notification visible exactly while work is in progress, which is both
//! what users expect and what Play's foreground-service policy requires.
//!
//! On desktop every function here is a no-op, so call sites in the shared
//! transfer managers need no `cfg` of their own.

#[cfg(target_os = "android")]
mod imp {
    use jni::objects::{JObject, JValue};
    use jni::JavaVM;
    use std::sync::atomic::{AtomicUsize, Ordering};

    /// Number of transfers currently in flight across all protocols.
    static ACTIVE: AtomicUsize = AtomicUsize::new(0);

    const SERVICE_CLASS: &str = "com.macnev2013.anyscp.TransferService";

    /// Invoke a static `(Context, String, String) -> void` or `(Context) -> void`
    /// method on TransferService.
    fn call_service(method: &str, args: Option<(&str, &str)>) {
        let ctx = ndk_context::android_context();

        // SAFETY: the NDK context is initialised by Tauri's Android runtime
        // before any command can run, and stays valid for the process lifetime.
        let Ok(vm) = (unsafe { JavaVM::from_raw(ctx.vm().cast()) }) else {
            tracing::warn!("foreground service: no JavaVM available");
            return;
        };
        let Ok(mut env) = vm.attach_current_thread() else {
            tracing::warn!("foreground service: could not attach thread");
            return;
        };
        let activity = unsafe { JObject::from_raw(ctx.context().cast()) };

        // Resolve through the Activity's class loader: FindClass on a natively
        // attached thread only searches the bootstrap loader and would miss
        // application classes.
        let result = (|| -> Result<(), jni::errors::Error> {
            let loader = env
                .call_method(&activity, "getClassLoader", "()Ljava/lang/ClassLoader;", &[])?
                .l()?;
            let name = env.new_string(SERVICE_CLASS)?;
            let class = env
                .call_method(
                    &loader,
                    "loadClass",
                    "(Ljava/lang/String;)Ljava/lang/Class;",
                    &[JValue::Object(&name)],
                )?
                .l()?;

            match args {
                Some((title, text)) => {
                    let j_title = env.new_string(title)?;
                    let j_text = env.new_string(text)?;
                    env.call_static_method(
                        &class,
                        method,
                        "(Landroid/content/Context;Ljava/lang/String;Ljava/lang/String;)V",
                        &[
                            JValue::Object(&activity),
                            JValue::Object(&j_title),
                            JValue::Object(&j_text),
                        ],
                    )?;
                }
                None => {
                    env.call_static_method(
                        &class,
                        method,
                        "(Landroid/content/Context;)V",
                        &[JValue::Object(&activity)],
                    )?;
                }
            }
            Ok(())
        })();

        if let Err(e) = result {
            // A logging failure must never break a transfer.
            let _ = env.exception_clear();
            tracing::warn!(error = %e, method, "foreground service call failed");
        }
    }

    /// Register a starting transfer, promoting the process on the first one.
    pub fn transfer_started(description: &str) {
        if ACTIVE.fetch_add(1, Ordering::SeqCst) == 0 {
            call_service("start", Some(("anySCP", description)));
        }
    }

    /// Register a finished transfer, demoting the process when the last ends.
    pub fn transfer_finished() {
        // `fetch_update` avoids underflowing below zero if a completion is ever
        // reported twice — safer than a bare fetch_sub on an unsigned counter.
        let previous = ACTIVE
            .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |v| {
                Some(v.saturating_sub(1))
            })
            .unwrap_or(0);

        if previous <= 1 {
            call_service("stop", None);
        }
    }
}

#[cfg(not(target_os = "android"))]
mod imp {
    /// Desktop processes are never frozen by the OS, so there is nothing to do.
    pub fn transfer_started(_description: &str) {}
    /// See [`transfer_started`].
    pub fn transfer_finished() {}
}

pub use imp::{transfer_finished, transfer_started};
