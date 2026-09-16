import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { DndContext } from "@dnd-kit/core";
import { SortableContext } from "@dnd-kit/sortable";
import { SortableCard } from "./SortableCard";

/**
 * The drag surface has to differ by input type, and the reason is a hard
 * timing conflict rather than a style preference:
 *
 *   @dnd-kit TouchSensor claims the gesture at 250ms
 *   useLongPress opens the context menu at 500ms
 *
 * With the whole card draggable, every hold on a phone becomes a reorder and
 * the context menu is unreachable. Moving the drag onto an explicit handle is
 * what frees the card body for long-press, so these tests pin that split.
 */

function mockViewport(mobile: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: query.includes("max-width") ? mobile : !mobile,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      onchange: null,
      dispatchEvent: () => false,
    }),
  });
}

function renderCard() {
  return render(
    <DndContext>
      <SortableContext items={["a"]}>
        <SortableCard id="a">
          <button type="button">Connect</button>
        </SortableCard>
      </SortableContext>
    </DndContext>,
  );
}

describe("SortableCard", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete (window as Partial<Window>).matchMedia;
  });

  it("exposes a drag handle on mobile", () => {
    mockViewport(true);
    renderCard();
    expect(screen.getByRole("button", { name: /Reorder/ })).toBeInTheDocument();
  });

  it("gives the handle a 44px touch target", () => {
    mockViewport(true);
    renderCard();
    const handle = screen.getByRole("button", { name: /Reorder/ });
    // WCAG 2.5.5 — the glyph is smaller, the hit area must not be. The strip
    // spans the card's full height, so only the width is a fixed 44px.
    expect(handle.className).toContain("w-11");
    expect(handle.className).toMatch(/top-0/);
    expect(handle.className).toMatch(/bottom-0/);
  });

  it("puts the handle in a left gutter, clear of the action strip", () => {
    mockViewport(true);
    const { container } = renderCard();
    const handle = screen.getByRole("button", { name: /Reorder/ });

    // Regression guard. HostCard and S3Card render a CardActionStrip at
    // `top-2 right-2`; a 44x44 handle anchored top-right covers its rightmost
    // button — Explorer on HostCard, which ~15 e2e specs click to open SFTP.
    // The handle must stay on the left, and the wrapper must reserve room for
    // it so it never sits on top of card content either.
    expect(handle.className).toContain("left-0");
    expect(handle.className).not.toContain("right-0");
    expect(
      (container.firstElementChild as HTMLElement).className,
    ).toContain("pl-11");
  });

  it("keeps the card body free of drag listeners on mobile", () => {
    mockViewport(true);
    const { container } = renderCard();
    const wrapper = container.firstElementChild as HTMLElement;
    // touch-none on the body would mean the body is still a drag surface;
    // it belongs on the handle instead, leaving the body for long-press.
    expect(wrapper.className).not.toContain("touch-none");
    expect(
      screen.getByRole("button", { name: /Reorder/ }).className,
    ).toContain("touch-none");
  });

  it("has no handle on desktop — the whole card drags", () => {
    mockViewport(false);
    renderCard();
    // A mouse has right-click, so there is no gesture conflict to resolve and
    // the larger drag surface is preferable.
    expect(screen.queryByRole("button", { name: /Reorder/ })).toBeNull();
  });

  it("keeps the whole card as the drag surface on desktop", () => {
    mockViewport(false);
    const { container } = renderCard();
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain("touch-none");
  });

  it.each([
    ["mobile", true],
    ["desktop", false],
  ])("renders its children on %s", (_label, mobile) => {
    mockViewport(mobile as boolean);
    const { container } = renderCard();
    // Queried by tag rather than role: useSortable's `attributes` put
    // role="button" on the wrapper too, so a role query matches both the
    // wrapper (named by its child's text) and the child itself.
    const child = container.querySelector("button:not([aria-label])");
    expect(child).toHaveTextContent("Connect");
  });
});
