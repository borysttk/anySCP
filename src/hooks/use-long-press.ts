import { useCallback, useRef } from "react";

/**
 * Long-press → context menu, for touch devices.
 *
 * Right-click has no touch equivalent, so every `onContextMenu` in the app is
 * unreachable on a phone. This hook supplies the missing gesture: hold for
 * {@link LONG_PRESS_MS}, get the same menu a right-click would have produced.
 *
 * Returned handlers are spread onto the same element that already carries
 * `onContextMenu`, and deliberately reuse its handler so the two entry points
 * can never drift apart.
 *
 * ## Why pointer events rather than touch events
 *
 * `onTouchStart`/`onTouchEnd` fire only for touch, so a hybrid device (a tablet
 * with a mouse, a Chromebook) would silently lose the gesture. Pointer events
 * cover both and let us filter on `pointerType`, which is what actually matters
 * here: a mouse already has right-click and must not get a competing long-press.
 */

/** Hold duration before the menu opens. */
const LONG_PRESS_MS = 500;

/**
 * Finger travel that cancels the press, in CSS pixels.
 *
 * A finger is never perfectly still, so zero tolerance would make the gesture
 * fire unreliably. This is also what separates a long-press from a scroll: past
 * this distance the user is panning the list, and opening a menu would hijack
 * the scroll.
 */
const MOVE_TOLERANCE_PX = 10;

export interface LongPressHandlers {
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onPointerCancel: (e: React.PointerEvent) => void;
}

/**
 * @param onLongPress Called with the coordinates the menu should open at —
 *   the same shape `onContextMenu` would supply from `clientX`/`clientY`.
 */
export function useLongPress(
  onLongPress: (position: { x: number; y: number }) => void,
): LongPressHandlers {
  const timer = useRef<number | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  // Set when the timer fires, so the click that follows the release can be
  // suppressed — otherwise a long-press on a host card would open the menu and
  // immediately connect.
  const fired = useRef(false);

  const clear = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    origin.current = null;
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      // A mouse has a real right-click; a stylus reports its own barrel button.
      // Adding a long-press for them would only introduce accidental menus.
      if (e.pointerType !== "touch") return;

      origin.current = { x: e.clientX, y: e.clientY };
      fired.current = false;

      timer.current = window.setTimeout(() => {
        fired.current = true;
        timer.current = null;

        // Haptic confirmation that the gesture registered. The menu animates in
        // right after, but the tick lands first and makes the hold feel
        // acknowledged rather than laggy. Unsupported on iOS Safari and behind
        // a user-activation requirement elsewhere, so failure is ignored.
        try {
          navigator.vibrate?.(10);
        } catch {
          /* vibration unavailable or blocked */
        }

        const at = origin.current;
        if (at) onLongPress(at);
      }, LONG_PRESS_MS);
    },
    [onLongPress],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const start = origin.current;
      if (!start || timer.current === null) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      // Compare squared distances to skip the square root.
      if (dx * dx + dy * dy > MOVE_TOLERANCE_PX * MOVE_TOLERANCE_PX) clear();
    },
    [clear],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (fired.current) {
        // The menu is already open; stop the tap from also triggering the
        // element's primary action.
        e.preventDefault();
        e.stopPropagation();
        fired.current = false;
      }
      clear();
    },
    [clear],
  );

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel: clear,
  };
}

export const __testing = { LONG_PRESS_MS, MOVE_TOLERANCE_PX };
