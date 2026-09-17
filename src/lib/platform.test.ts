import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  getPlatform,
  isMobile,
  supportsSelfUpdate,
  supportsProcessControl,
  supportsNativeFileIntegration,
  __resetPlatformCache,
} from "./platform";

/** Install a fake `__TAURI_INTERNALS__` reporting `platform`. */
function setTauriPlatform(platform: string): void {
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
    metadata: { currentPlatform: platform },
  };
  __resetPlatformCache();
}

describe("platform detection", () => {
  beforeEach(() => {
    __resetPlatformCache();
  });

  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    __resetPlatformCache();
  });

  it("identifies Android from the Tauri metadata", () => {
    setTauriPlatform("android");
    expect(getPlatform()).toBe("android");
    expect(isMobile()).toBe(true);
  });

  it.each([
    ["macos", "macos"],
    ["windows", "windows"],
    ["linux", "linux"],
  ])("identifies %s as a desktop platform", (reported, expected) => {
    setTauriPlatform(reported);
    expect(getPlatform()).toBe(expected);
    expect(isMobile()).toBe(false);
  });

  it("memoises the result so repeated calls stay cheap", () => {
    setTauriPlatform("android");
    expect(getPlatform()).toBe("android");

    // Change the underlying value without resetting the cache — the memoised
    // answer must win, since the platform cannot change mid-session.
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
      metadata: { currentPlatform: "linux" },
    };
    expect(getPlatform()).toBe("android");
  });

  it("falls back to 'unknown' outside Tauri rather than throwing", () => {
    // jsdom with no Tauri runtime and a non-Android user agent.
    expect(getPlatform()).toBe("unknown");
    expect(isMobile()).toBe(false);
  });
});

describe("feature gates", () => {
  beforeEach(() => __resetPlatformCache());
  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    __resetPlatformCache();
  });

  it("disables self-update, process control and native file integration on Android", () => {
    setTauriPlatform("android");
    expect(supportsSelfUpdate()).toBe(false);
    expect(supportsProcessControl()).toBe(false);
    expect(supportsNativeFileIntegration()).toBe(false);
  });

  it("keeps every desktop capability enabled on macOS", () => {
    setTauriPlatform("macos");
    expect(supportsSelfUpdate()).toBe(true);
    expect(supportsProcessControl()).toBe(true);
    expect(supportsNativeFileIntegration()).toBe(true);
  });
});
