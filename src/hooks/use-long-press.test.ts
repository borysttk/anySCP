import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useLongPress, __testing } from "./use-long-press";

const { LONG_PRESS_MS, MOVE_TOLERANCE_PX } = __testing;

/** Minimal stand-in for the React synthetic pointer event fields used. */
function pointer(overrides: Partial<{ pointerType: string; clientX: number; clientY: number }> = {}) {
  return {
    pointerType: "touch",
    clientX: 100,
    clientY: 100,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    ...overrides,
  } as unknown as React.PointerEvent;
}

describe("useLongPress", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("fires after the hold threshold with the press coordinates", () => {
    const onLongPress = vi.fn();
    const { result } = renderHook(() => useLongPress(onLongPress));

    act(() => result.current.onPointerDown(pointer({ clientX: 42, clientY: 99 })));
    expect(onLongPress).not.toHaveBeenCalled();

    act(() => void vi.advanceTimersByTime(LONG_PRESS_MS));
    // The menu must open where the finger was, matching onContextMenu's
    // clientX/clientY contract.
    expect(onLongPress).toHaveBeenCalledWith({ x: 42, y: 99 });
  });

  it("does not fire before the threshold", () => {
    const onLongPress = vi.fn();
    const { result } = renderHook(() => useLongPress(onLongPress));

    act(() => result.current.onPointerDown(pointer()));
    act(() => void vi.advanceTimersByTime(LONG_PRESS_MS - 50));
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it("ignores mouse input, which already has right-click", () => {
    const onLongPress = vi.fn();
    const { result } = renderHook(() => useLongPress(onLongPress));

    act(() => result.current.onPointerDown(pointer({ pointerType: "mouse" })));
    act(() => void vi.advanceTimersByTime(LONG_PRESS_MS * 2));
    // Otherwise holding the mouse button down would open a duplicate menu.
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it("ignores pen input, which has a barrel button", () => {
    const onLongPress = vi.fn();
    const { result } = renderHook(() => useLongPress(onLongPress));

    act(() => result.current.onPointerDown(pointer({ pointerType: "pen" })));
    act(() => void vi.advanceTimersByTime(LONG_PRESS_MS * 2));
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it("cancels once the finger travels past the tolerance — that is a scroll", () => {
    const onLongPress = vi.fn();
    const { result } = renderHook(() => useLongPress(onLongPress));

    act(() => result.current.onPointerDown(pointer({ clientX: 100, clientY: 100 })));
    act(() =>
      result.current.onPointerMove(
        pointer({ clientX: 100, clientY: 100 + MOVE_TOLERANCE_PX + 5 }),
      ),
    );
    act(() => void vi.advanceTimersByTime(LONG_PRESS_MS));
    // Opening a menu mid-scroll would hijack the pan.
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it("tolerates small jitter, since a finger is never perfectly still", () => {
    const onLongPress = vi.fn();
    const { result } = renderHook(() => useLongPress(onLongPress));

    act(() => result.current.onPointerDown(pointer({ clientX: 100, clientY: 100 })));
    act(() => result.current.onPointerMove(pointer({ clientX: 103, clientY: 102 })));
    act(() => void vi.advanceTimersByTime(LONG_PRESS_MS));
    expect(onLongPress).toHaveBeenCalledOnce();
  });

  it("cancels on pointer cancel (system gesture took over)", () => {
    const onLongPress = vi.fn();
    const { result } = renderHook(() => useLongPress(onLongPress));

    act(() => result.current.onPointerDown(pointer()));
    act(() => result.current.onPointerCancel(pointer()));
    act(() => void vi.advanceTimersByTime(LONG_PRESS_MS));
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it("does not fire when the finger lifts early", () => {
    const onLongPress = vi.fn();
    const { result } = renderHook(() => useLongPress(onLongPress));

    act(() => result.current.onPointerDown(pointer()));
    act(() => void vi.advanceTimersByTime(200));
    act(() => result.current.onPointerUp(pointer()));
    act(() => void vi.advanceTimersByTime(LONG_PRESS_MS));
    // A quick tap is the element's primary action, not a menu.
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it("suppresses the tap that follows a completed long-press", () => {
    const onLongPress = vi.fn();
    const { result } = renderHook(() => useLongPress(onLongPress));

    act(() => result.current.onPointerDown(pointer()));
    act(() => void vi.advanceTimersByTime(LONG_PRESS_MS));

    const up = pointer();
    act(() => result.current.onPointerUp(up));
    // Without this a long-press on a host card opens the menu *and* connects.
    expect(up.preventDefault).toHaveBeenCalled();
    expect(up.stopPropagation).toHaveBeenCalled();
  });

  it("leaves a normal tap's default behaviour intact", () => {
    const onLongPress = vi.fn();
    const { result } = renderHook(() => useLongPress(onLongPress));

    act(() => result.current.onPointerDown(pointer()));
    const up = pointer();
    act(() => result.current.onPointerUp(up));
    expect(up.preventDefault).not.toHaveBeenCalled();
  });

  it("gives haptic feedback when the gesture registers", () => {
    const vibrate = vi.fn();
    Object.defineProperty(navigator, "vibrate", { value: vibrate, configurable: true });
    const { result } = renderHook(() => useLongPress(vi.fn()));

    act(() => result.current.onPointerDown(pointer()));
    act(() => void vi.advanceTimersByTime(LONG_PRESS_MS));
    expect(vibrate).toHaveBeenCalled();
  });

  it("still fires when vibration is unavailable", () => {
    Object.defineProperty(navigator, "vibrate", {
      value: () => {
        throw new Error("blocked without user activation");
      },
      configurable: true,
    });
    const onLongPress = vi.fn();
    const { result } = renderHook(() => useLongPress(onLongPress));

    act(() => result.current.onPointerDown(pointer()));
    act(() => void vi.advanceTimersByTime(LONG_PRESS_MS));
    // iOS Safari has no vibrate at all; the menu must not depend on it.
    expect(onLongPress).toHaveBeenCalled();
  });

  it("does not fire twice for one press", () => {
    const onLongPress = vi.fn();
    const { result } = renderHook(() => useLongPress(onLongPress));

    act(() => result.current.onPointerDown(pointer()));
    act(() => void vi.advanceTimersByTime(LONG_PRESS_MS * 3));
    expect(onLongPress).toHaveBeenCalledOnce();
  });
});
