import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { __resetPlatformCache } from "./platform";

/**
 * `pickDownloadTarget` hides a genuine behavioural split: on desktop the chosen
 * path is the final destination, while on Android it is a staging path that
 * must be copied into a SAF `content://` URI afterwards. Getting the branch
 * wrong silently strands downloads inside the app sandbox where the user cannot
 * reach them, so both paths are pinned here.
 */

const invoke = vi.fn();
const save = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: (...a: unknown[]) => save(...a) }));

/** Pretend to be the Android build by faking what platform.ts reads. */
function setPlatform(platform: string) {
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
    metadata: { currentPlatform: platform },
  };
  __resetPlatformCache();
}

describe("pickDownloadTarget", () => {
  beforeEach(() => {
    invoke.mockReset();
    save.mockReset();
  });

  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    __resetPlatformCache();
  });

  it("returns the dialog path unchanged on desktop", async () => {
    setPlatform("macos");
    save.mockResolvedValue("/Users/me/Downloads/report.pdf");
    const { pickDownloadTarget } = await import("./download-target");

    const target = await pickDownloadTarget("report.pdf");

    expect(target?.path).toBe("/Users/me/Downloads/report.pdf");
    // Desktop writes straight to the destination — no SAF round-trip.
    expect(invoke).not.toHaveBeenCalled();
  });

  it("finalize is a no-op on desktop", async () => {
    setPlatform("linux");
    save.mockResolvedValue("/home/me/f.txt");
    const { pickDownloadTarget } = await import("./download-target");

    const target = await pickDownloadTarget("f.txt");
    await target?.finalize();

    expect(invoke).not.toHaveBeenCalled();
  });

  it("returns null when the desktop dialog is dismissed", async () => {
    setPlatform("windows");
    save.mockResolvedValue(null);
    const { pickDownloadTarget } = await import("./download-target");

    expect(await pickDownloadTarget("x.bin")).toBeNull();
  });

  it("downloads to a staging path on Android, then copies into the SAF URI", async () => {
    setPlatform("android");
    invoke.mockImplementation((cmd: string) => {
      if (cmd === "sftp_saf_begin_export") {
        return Promise.resolve({
          stagingPath: "/data/data/com.macnev2013.anyscp/cache/saf-1/report.pdf",
          uri: "content://com.android.providers.downloads/document/42",
        });
      }
      return Promise.resolve(0);
    });
    const { pickDownloadTarget } = await import("./download-target");

    const target = await pickDownloadTarget("report.pdf");
    // The transfer must target the private staging path, never the URI.
    expect(target?.path).toContain("/cache/saf-1/");
    expect(save).not.toHaveBeenCalled();

    await target?.finalize();
    expect(invoke).toHaveBeenCalledWith("sftp_saf_finish_export", {
      stagingPath: "/data/data/com.macnev2013.anyscp/cache/saf-1/report.pdf",
      uri: "content://com.android.providers.downloads/document/42",
    });
  });

  it("treats a dismissed Android picker as a cancel, not an error", async () => {
    setPlatform("android");
    invoke.mockRejectedValue("user cancelled the file picker");
    const { pickDownloadTarget } = await import("./download-target");

    await expect(pickDownloadTarget("a.txt")).resolves.toBeNull();
  });

  it("does not copy twice when finalize is called repeatedly", async () => {
    setPlatform("android");
    invoke.mockResolvedValue({ stagingPath: "/cache/saf-2/a.txt", uri: "content://x" });
    const { pickDownloadTarget } = await import("./download-target");

    const target = await pickDownloadTarget("a.txt");
    invoke.mockClear();
    invoke.mockResolvedValue(10);

    await target?.finalize();
    await target?.finalize();

    // A second copy would duplicate the file into the user's chosen location.
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("discard after finalize does not re-run the export", async () => {
    setPlatform("android");
    invoke.mockResolvedValue({ stagingPath: "/cache/saf-3/a.txt", uri: "content://y" });
    const { pickDownloadTarget } = await import("./download-target");

    const target = await pickDownloadTarget("a.txt");
    invoke.mockClear();
    invoke.mockResolvedValue(10);

    await target?.finalize();
    await target?.discard();

    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("discard swallows backend errors so cleanup never masks the real failure", async () => {
    setPlatform("android");
    invoke.mockResolvedValue({ stagingPath: "/cache/saf-4/a.txt", uri: "content://z" });
    const { pickDownloadTarget } = await import("./download-target");

    const target = await pickDownloadTarget("a.txt");
    invoke.mockRejectedValue("staging dir already gone");

    await expect(target?.discard()).resolves.toBeUndefined();
  });
});
