package com.macnev2013.anyscp

import android.annotation.SuppressLint
import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * Secure credential storage backing the Rust `vault` module on Android.
 *
 * SSH passwords and key passphrases are stored in an
 * [EncryptedSharedPreferences] file whose AES-256-GCM master key lives in the
 * hardware-backed Android Keystore. The key material never leaves the Keystore
 * and is never visible to the Rust side — only decrypted values cross JNI,
 * which mirrors how the desktop Keychain / Credential Manager backends behave.
 *
 * Called from `src-tauri/src/vault/android_store.rs` via JNI. The four methods
 * are `@JvmStatic` so Rust can invoke them with `CallStaticVoidMethod` and
 * friends without constructing an instance. Signatures are load-bearing —
 * changing one means changing the JNI descriptor string on the Rust side.
 *
 * ## Deployment
 * The Tauri Android scaffold is generated into `src-tauri/gen/android/`, which
 * is gitignored. `make android-sync` copies this file into
 * `gen/android/app/src/main/java/com/macnev2013/anyscp/` after `android init`,
 * so the canonical copy stays version-controlled here.
 */
object SecureStore {

    private const val PREFS_FILE = "anyscp_secure_credentials"

    /**
     * Initialised on first use from the Tauri activity context.
     *
     * Building [EncryptedSharedPreferences] touches the Keystore and is slow
     * (tens of ms), so the instance is cached for the process lifetime.
     */
    @Volatile
    private var prefs: SharedPreferences? = null

    /**
     * Application context captured at startup by [init].
     *
     * Held as the *application* context, never an Activity, so this object
     * cannot leak a destroyed Activity across configuration changes.
     */
    @SuppressLint("StaticFieldLeak")
    @Volatile
    private var appContext: Context? = null

    /**
     * Seed the application context. Call once from `MainActivity.onCreate`,
     * before any Rust code can reach the vault.
     */
    @JvmStatic
    fun init(context: Context) {
        appContext = context.applicationContext
    }

    /**
     * Lazily build (or return) the encrypted preferences instance.
     *
     * Double-checked locking: reads are lock-free after the first call, while
     * concurrent first-callers — Tokio worker threads, which may well race —
     * cannot build two instances over the same file.
     */
    private fun prefs(): SharedPreferences {
        prefs?.let { return it }
        synchronized(this) {
            prefs?.let { return it }

            val context = appContext
                ?: error("SecureStore.init(context) was not called before use")

            val masterKey = MasterKey.Builder(context)
                .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                .build()

            val created = EncryptedSharedPreferences.create(
                context,
                PREFS_FILE,
                masterKey,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
            )
            prefs = created
            return created
        }
    }

    /**
     * Store [value] under [key], replacing any existing entry.
     *
     * Uses a synchronous `commit()` rather than `apply()`: the Rust caller
     * treats a successful return as durable, and an async write could still be
     * in flight if the process is killed immediately afterwards.
     */
    @JvmStatic
    fun save(key: String, value: String) {
        prefs().edit().putString(key, value).commit()
    }

    /** Return the value for [key], or `null` when absent. */
    @JvmStatic
    fun load(key: String): String? = prefs().getString(key, null)

    /** Remove [key]. Deleting an absent key is a no-op, matching desktop. */
    @JvmStatic
    fun delete(key: String) {
        prefs().edit().remove(key).commit()
    }

    /** Whether [key] exists, without decrypting the value. */
    @JvmStatic
    fun contains(key: String): Boolean = prefs().contains(key)
}
