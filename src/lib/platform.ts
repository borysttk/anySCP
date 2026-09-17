/**
 * Runtime platform detection for the Android port.
 *
 * Several features are desktop-only — the updater and process plugins have no
 * Android implementation, external editors cannot be launched, and drag-out to
 * the OS does not exist. The backend already returns descriptive errors for
 * those (see `src-tauri/src/platform/mod.rs`), but the UI should not offer the
 * affordance in the first place.
 *
 * Detection reads the `tauri` platform string that the Tauri runtime injects
 * into the webview at startup. It is resolved once and cached: the value cannot
 * change during a session, and the check sits on render paths.
 */

export type Platform = "android" | "ios" | "macos" | "windows" | "linux" | "unknown";

/**
 * Shape of the `__TAURI_INTERNALS__` bag the Tauri runtime injects. Only the
 * fields used here are declared; the object carries considerably more.
 */
interface TauriInternals {
  metadata?: {
    /** Set by the Tauri runtime; matches Rust's `tauri::Env` OS string. */
    currentPlatform?: string;
  };
}

let cached: Platform | null = null;

/**
 * Best-effort platform identification.
 *
 * Falls back to the user-agent when the Tauri metadata is unavailable — for
 * example under Vitest (jsdom), where no Tauri runtime exists. That path only
 * needs to be good enough to keep tests on the desktop branch.
 */
export function getPlatform(): Platform {
  if (cached !== null) return cached;

  if (typeof window !== "undefined") {
    const internals = (window as unknown as { __TAURI_INTERNALS__?: TauriInternals })
      .__TAURI_INTERNALS__;
    const reported = internals?.metadata?.currentPlatform?.toLowerCase();

    if (reported) {
      if (reported.includes("android")) return (cached = "android");
      if (reported.includes("ios")) return (cached = "ios");
      if (reported.includes("macos") || reported.includes("darwin")) return (cached = "macos");
      if (reported.includes("windows")) return (cached = "windows");
      if (reported.includes("linux")) return (cached = "linux");
    }

    // jsdom and any non-Tauri host land here.
    const ua = navigator?.userAgent ?? "";
    if (/android/i.test(ua)) return (cached = "android");
  }

  return (cached = "unknown");
}

/** `true` on a touch-first mobile OS (currently only Android is shipped). */
export function isMobile(): boolean {
  const p = getPlatform();
  return p === "android" || p === "ios";
}

/**
 * Whether in-app self-update is available.
 *
 * False on mobile: `tauri-plugin-updater` has no Android/iOS implementation and
 * Google Play forbids apps installing their own updates.
 */
export function supportsSelfUpdate(): boolean {
  return !isMobile();
}

/**
 * Whether the app can relaunch or exit itself (`tauri-plugin-process`).
 * Unsupported on Android/iOS.
 */
export function supportsProcessControl(): boolean {
  return !isMobile();
}

/**
 * Whether files can be dragged out to the host OS, and whether external
 * editors can be launched. Both are desktop-only concepts.
 */
export function supportsNativeFileIntegration(): boolean {
  return !isMobile();
}

/** Test-only: clear the memoised value between cases. */
export function __resetPlatformCache(): void {
  cached = null;
}
