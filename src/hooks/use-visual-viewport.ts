import { useEffect } from "react";
import { isMobile } from "../lib/platform";

/**
 * Keep the terminal usable while the Android soft keyboard is open.
 *
 * Android resizes the webview when the IME appears (the activity uses
 * `adjustResize`), but the resize is not always reflected in a `ResizeObserver`
 * callback on the terminal container, and on some OEM keyboards the viewport
 * shrinks without any layout event at all. The result is a prompt hidden behind
 * the keyboard.
 *
 * `window.visualViewport` reports the region actually visible to the user, so
 * we mirror its height onto a CSS custom property and re-fit the terminal when
 * it changes. Desktop is unaffected: the effect does not attach there.
 *
 * @param onResize Invoked (debounced to an animation frame) whenever the
 *   visible viewport changes — typically a `fitAddon.fit()` call.
 */
export function useVisualViewport(onResize?: () => void): void {
  useEffect(() => {
    if (!isMobile()) return;

    const vv = window.visualViewport;
    if (!vv) return;

    let frame = 0;

    const apply = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        // Expose the visible height so layout can size against the region the
        // keyboard leaves free, rather than the full window height.
        document.documentElement.style.setProperty("--visual-viewport-height", `${vv.height}px`);

        // How much of the window the keyboard covers. Used to pad the terminal
        // and to position the key toolbar directly above the IME.
        const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
        document.documentElement.style.setProperty("--keyboard-inset", `${inset}px`);

        onResize?.();
      });
    };

    apply();
    vv.addEventListener("resize", apply);
    vv.addEventListener("scroll", apply);

    return () => {
      cancelAnimationFrame(frame);
      vv.removeEventListener("resize", apply);
      vv.removeEventListener("scroll", apply);
      document.documentElement.style.removeProperty("--visual-viewport-height");
      document.documentElement.style.removeProperty("--keyboard-inset");
    };
  }, [onResize]);
}
