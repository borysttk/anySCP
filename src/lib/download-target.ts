import { isMobile } from "./platform";

/**
 * Resolve where a downloaded file should be written, hiding the desktop/Android
 * split from callers.
 *
 * Desktop uses a native save dialog and gets a real filesystem path back, so a
 * download can write straight to its destination.
 *
 * Android cannot: Scoped Storage (API 29+) forbids writing to public paths like
 * `/sdcard/Download`, and the only sanctioned destination is an opaque
 * `content://` URI from the system picker — which is not a path and cannot be
 * opened by the SFTP code. The backend therefore hands back an app-private
 * staging path to download into, plus the URI to copy into afterwards.
 *
 * Callers download to `path`, then call {@link finalizeDownload} exactly once.
 */
export interface DownloadTarget {
  /** Filesystem path the transfer should write to. */
  path: string;
  /**
   * Completes the export. No-op on desktop (the file is already in place); on
   * Android copies the staged file into the user's chosen location and clears
   * the staging directory.
   */
  finalize: () => Promise<void>;
  /** Discards a staged file when the transfer failed or was cancelled. */
  discard: () => Promise<void>;
}

/**
 * Ask the user where to save `fileName`.
 *
 * Returns `null` if the picker was dismissed — callers should treat that as a
 * silent cancel, not an error.
 */
export async function pickDownloadTarget(
  fileName: string,
): Promise<DownloadTarget | null> {
  const { invoke } = await import("@tauri-apps/api/core");

  if (isMobile()) {
    let staged: { stagingPath: string; uri: string };
    try {
      staged = await invoke<{ stagingPath: string; uri: string }>(
        "sftp_saf_begin_export",
        { fileName },
      );
    } catch {
      // The backend reports a dismissed picker as an error; there is nothing
      // to clean up and nothing worth showing the user.
      return null;
    }

    let settled = false;
    return {
      path: staged.stagingPath,
      finalize: async () => {
        if (settled) return;
        settled = true;
        await invoke("sftp_saf_finish_export", {
          stagingPath: staged.stagingPath,
          uri: staged.uri,
        });
      },
      // finish_export removes the staging directory as a side effect, so a
      // discard is expressed as a finalize whose failure is ignored — the
      // alternative would be leaking cache files after every failed transfer.
      discard: async () => {
        if (settled) return;
        settled = true;
        try {
          await invoke("sftp_saf_finish_export", {
            stagingPath: staged.stagingPath,
            uri: staged.uri,
          });
        } catch {
          /* best effort */
        }
      },
    };
  }

  const { save } = await import("@tauri-apps/plugin-dialog");
  const savePath = await save({
    defaultPath: fileName,
    title: `Save "${fileName}" as…`,
  });
  if (!savePath) return null;

  return {
    path: savePath,
    finalize: async () => {},
    discard: async () => {},
  };
}
