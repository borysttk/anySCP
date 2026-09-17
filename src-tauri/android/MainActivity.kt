package com.macnev2013.anyscp

/**
 * Activity entry point, overriding Tauri's generated `MainActivity` so the
 * Rust core is notified when the process is resumed.
 *
 * ## Why the native callbacks rather than webview events
 *
 * Android freezes a backgrounded process and reaps its TCP sockets without
 * notifying the peer. On resume the Rust session map still looks healthy while
 * the transport underneath is dead, so keystrokes disappear into a socket that
 * goes nowhere.
 *
 * Detecting this from JavaScript is unreliable: the OS can freeze the JS event
 * loop before `visibilitychange` or `tauri://focus` fires, and some OEM ROMs
 * never deliver those events at all. `Activity.onResume` is guaranteed by the
 * platform, so the health sweep is driven from here instead — it starts before
 * the webview has even regained focus.
 *
 * `nativeOnResume` returns immediately; the probing happens on the Tokio
 * runtime. Blocking here would stall the UI thread and risk an ANR.
 *
 * ## Installation
 *
 * `tauri android init` generates its own `MainActivity.kt`. `make android-sync`
 * overwrites it with this file. If a future Tauri version changes the generated
 * activity's base class or package, reconcile this file with the generated one
 * rather than the other way round.
 */
class MainActivity : TauriActivity() {
    override fun onResume() {
        super.onResume()
        // Guarded: if the native library has not finished loading there is
        // nothing connected yet, so a missed callback is harmless — whereas an
        // UnsatisfiedLinkError here would crash the activity on launch.
        runCatching { nativeOnResume() }
    }

    override fun onPause() {
        super.onPause()
        runCatching { nativeOnPause() }
    }

    /**
     * Forward document-picker results to the SAF bridge.
     *
     * Request codes are allocated by [SafBridge] from 1000 up; anything else
     * belongs to Tauri's own plugins and must reach `super` untouched.
     */
    @Deprecated("startActivityForResult is the API TauriActivity itself targets")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: android.content.Intent?) {
        if (requestCode >= 1000) {
            SafBridge.handleActivityResult(requestCode, resultCode, data)
            return
        }
        @Suppress("DEPRECATION")
        super.onActivityResult(requestCode, resultCode, data)
    }

    /** Implemented in `src-tauri/src/platform/lifecycle.rs`. */
    private external fun nativeOnResume()

    /** Implemented in `src-tauri/src/platform/lifecycle.rs`. */
    private external fun nativeOnPause()
}
