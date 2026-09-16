import { useSyncExternalStore } from "react";

/**
 * Subscribe to a CSS media query.
 *
 * `useSyncExternalStore` rather than `useState` + an effect: the value is read
 * during render, so the first paint is already correct. The effect-based
 * version renders once with a guessed value and then corrects itself, which
 * for a layout switch is a visible flash of the wrong layout.
 *
 * Safe under SSR and in test environments without `matchMedia` — both fall back
 * to `false`, i.e. the desktop layout.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window === "undefined" || !window.matchMedia) return () => {};
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    () => {
      if (typeof window === "undefined" || !window.matchMedia) return false;
      return window.matchMedia(query).matches;
    },
    () => false,
  );
}

/**
 * Tailwind's `sm` breakpoint (640px) is the app's desktop/mobile divide, and
 * this constant keeps the JS checks in step with the `sm:` classes in markup.
 * Phones in portrait fall below it; tablets and split-screen windows do not.
 */
export const MOBILE_QUERY = "(max-width: 639px)";

/** True on phone-width viewports. See {@link MOBILE_QUERY}. */
export function useIsMobileViewport(): boolean {
  return useMediaQuery(MOBILE_QUERY);
}

/**
 * Whether the device's primary input can hover.
 *
 * Distinct from viewport width: a small window on a laptop still has a mouse
 * and should keep hover-driven affordances, while a large tablet should not.
 */
export function useHasHover(): boolean {
  return useMediaQuery("(hover: hover)");
}
