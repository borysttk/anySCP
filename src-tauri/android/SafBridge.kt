package com.macnev2013.anyscp

import android.app.Activity
import android.content.Intent
import android.net.Uri
import java.util.concurrent.atomic.AtomicInteger

/**
 * Storage Access Framework bridge.
 *
 * Since Android 10 (API 29) Scoped Storage forbids writing to absolute paths
 * like `/sdcard/Download`. The only sanctioned way to put a file somewhere the
 * user can reach it is to ask the system document picker for a destination and
 * write through the returned `content://` URI.
 *
 * That flow is inherently asynchronous — it is an activity result — while the
 * Rust transfer code is a straight-line async function. This object bridges the
 * two: [requestCreateDocument] launches the picker and returns a request ID;
 * when the result arrives, [handleActivityResult] hands the URI back to Rust,
 * which completes the pending future keyed by that ID.
 *
 * Downloads themselves still land in app-private cache first. Streaming
 * straight into the SAF URI would mean a half-written document in the user's
 * Downloads folder if the transfer failed midway; staging and then copying
 * keeps the visible result all-or-nothing.
 */
object SafBridge {
    /** Distinguishes concurrent picker requests. */
    private val nextRequestId = AtomicInteger(1000)

    /**
     * Launch the "create document" picker.
     *
     * @param mimeType best-effort content type; `application/octet-stream` is
     *   a safe default when the extension is unknown.
     * @return the request code that [handleActivityResult] will report back.
     */
    @JvmStatic
    fun requestCreateDocument(activity: Activity, fileName: String, mimeType: String): Int {
        val requestId = nextRequestId.getAndIncrement()
        val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = mimeType
            putExtra(Intent.EXTRA_TITLE, fileName)
        }
        activity.startActivityForResult(intent, requestId)
        return requestId
    }

    /**
     * Launch the directory picker, used when downloading a whole remote folder.
     *
     * The granted tree URI is persistable, so the caller can keep writing into
     * that directory for the rest of the transfer without re-prompting.
     */
    @JvmStatic
    fun requestOpenDocumentTree(activity: Activity): Int {
        val requestId = nextRequestId.getAndIncrement()
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE)
        activity.startActivityForResult(intent, requestId)
        return requestId
    }

    /**
     * Copy a staged file into a SAF destination and delete the staging copy.
     *
     * Runs on whichever thread Rust calls it from — never the UI thread.
     * Returns the number of bytes written, or -1 on failure.
     */
    @JvmStatic
    fun copyFileToUri(activity: Activity, sourcePath: String, uriString: String): Long {
        return try {
            val uri = Uri.parse(uriString)
            val source = java.io.File(sourcePath)
            var total = 0L
            activity.contentResolver.openOutputStream(uri)?.use { out ->
                source.inputStream().use { input ->
                    val buffer = ByteArray(64 * 1024)
                    while (true) {
                        val read = input.read(buffer)
                        if (read <= 0) break
                        out.write(buffer, 0, read)
                        total += read
                    }
                    out.flush()
                }
            } ?: return -1
            source.delete()
            total
        } catch (e: Exception) {
            android.util.Log.e("anySCP", "SAF copy failed", e)
            -1
        }
    }

    /**
     * Forwarded from `MainActivity.onActivityResult`.
     *
     * A cancelled picker yields a null URI, which Rust turns into a clean
     * "cancelled" error rather than a failure.
     */
    @JvmStatic
    fun handleActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        val uri: String? = if (resultCode == Activity.RESULT_OK) data?.data?.toString() else null
        nativeOnSafResult(requestCode, uri)
    }

    /** Implemented in `src-tauri/src/platform/saf.rs`. */
    @JvmStatic
    external fun nativeOnSafResult(requestCode: Int, uri: String?)
}
