import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ContextMenu } from "./ContextMenu";
import type { ContextMenuItem } from "./ContextMenu";

const ITEMS: ContextMenuItem[] = [
  { label: "Download", onClick: vi.fn() },
  { label: "Rename", onClick: vi.fn() },
];

/** Make the menu report a fixed rendered size (jsdom has no layout). */
function mockMenuSize(width: number, height: number) {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    width,
    height,
    top: 0,
    left: 0,
    right: width,
    bottom: height,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
}

function menuStyle(): CSSStyleDeclaration {
  return (screen.getByRole("menu", { name: "Context menu" }) as HTMLElement).style;
}

function menuEl(): HTMLElement {
  return screen.getByRole("menu", { name: "Context menu" });
}

/**
 * jsdom has no `matchMedia`. Installing a stub that reports `matches` for the
 * mobile query is what flips the component into bottom-sheet mode; without it
 * every test exercises the desktop popover.
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

describe("ContextMenu", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // jsdom default viewport is 1024x768; make it explicit for the math below.
    Object.defineProperty(window, "innerWidth", { value: 1024, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 768, configurable: true });
    delete (window as Partial<Window>).matchMedia;
  });

  it("renders at the requested position when it fits", () => {
    mockMenuSize(200, 80);
    render(<ContextMenu items={ITEMS} position={{ x: 100, y: 100 }} onClose={vi.fn()} />);
    const style = menuStyle();
    expect(style.left).toBe("100px");
    expect(style.top).toBe("100px");
    expect(style.visibility).not.toBe("hidden");
  });

  it("clamps to the viewport using the menu's measured size", () => {
    mockMenuSize(200, 80);
    render(<ContextMenu items={ITEMS} position={{ x: 1000, y: 750 }} onClose={vi.fn()} />);
    const style = menuStyle();
    // 1024 - 200 - 8 margin = 816; 768 - 80 - 8 = 680
    expect(style.left).toBe("816px");
    expect(style.top).toBe("680px");
  });

  it("never clamps past the top-left margin", () => {
    mockMenuSize(2000, 2000); // larger than the viewport
    render(<ContextMenu items={ITEMS} position={{ x: 500, y: 500 }} onClose={vi.fn()} />);
    const style = menuStyle();
    expect(style.left).toBe("8px");
    expect(style.top).toBe("8px");
  });

  it("closes on window blur (click outside the webview)", () => {
    mockMenuSize(200, 80);
    const onClose = vi.fn();
    render(<ContextMenu items={ITEMS} position={{ x: 10, y: 10 }} onClose={onClose} />);
    fireEvent.blur(window);
    expect(onClose).toHaveBeenCalled();
  });

  it("closes on window resize (fullscreen toggle)", () => {
    mockMenuSize(200, 80);
    const onClose = vi.fn();
    render(<ContextMenu items={ITEMS} position={{ x: 10, y: 10 }} onClose={onClose} />);
    fireEvent.resize(window);
    expect(onClose).toHaveBeenCalled();
  });

  it("closes on outside mousedown but not on clicks inside the menu", () => {
    mockMenuSize(200, 80);
    const onClose = vi.fn();
    render(<ContextMenu items={ITEMS} position={{ x: 10, y: 10 }} onClose={onClose} />);
    fireEvent.mouseDown(screen.getByRole("menuitem", { name: "Download" }));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalled();
  });

  it("runs the item action then closes", () => {
    mockMenuSize(200, 80);
    const onClose = vi.fn();
    const onClick = vi.fn();
    render(
      <ContextMenu
        items={[{ label: "Download", onClick }]}
        position={{ x: 10, y: 10 }}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Download" }));
    expect(onClick).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});

/**
 * On a phone a cursor-anchored popover is the wrong shape: there is no cursor,
 * and a menu pinned to the touch point sits under the thumb that opened it.
 * Below `sm` the same items render as a bottom sheet instead.
 */
describe("ContextMenu — bottom sheet (mobile viewport)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(window, "innerWidth", { value: 390, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 844, configurable: true });
    mockViewport(true);
  });

  it("pins to the bottom of the screen instead of the touch point", () => {
    render(<ContextMenu items={ITEMS} position={{ x: 200, y: 400 }} onClose={vi.fn()} />);
    const el = menuEl();
    expect(el.className).toContain("bottom-0");
    expect(el.className).toContain("inset-x-0");
    // The touch coordinates must not leak into inline positioning.
    expect(menuStyle().left).toBe("");
    expect(menuStyle().top).toBe("");
  });

  it("respects the bottom safe-area inset", () => {
    render(<ContextMenu items={ITEMS} position={{ x: 0, y: 0 }} onClose={vi.fn()} />);
    // Without this the last row sits under the gesture bar.
    expect(menuEl().className).toContain("env(safe-area-inset-bottom)");
  });

  it("caps its height and contains overscroll", () => {
    render(<ContextMenu items={ITEMS} position={{ x: 0, y: 0 }} onClose={vi.fn()} />);
    const cls = menuEl().className;
    // A long menu must scroll rather than run off-screen, and must not
    // chain-scroll the list behind it.
    expect(cls).toContain("max-h-[70vh]");
    expect(cls).toContain("overscroll-contain");
  });

  it("closes when the scrim is tapped", () => {
    const onClose = vi.fn();
    const { container } = render(
      <ContextMenu items={ITEMS} position={{ x: 0, y: 0 }} onClose={onClose} />,
    );
    const scrim = container.querySelector("[aria-hidden='true'].fixed.inset-0");
    expect(scrim).not.toBeNull();
    fireEvent.click(scrim!);
    expect(onClose).toHaveBeenCalled();
  });

  it("gives every row a 44px touch target", () => {
    render(<ContextMenu items={ITEMS} position={{ x: 0, y: 0 }} onClose={vi.fn()} />);
    for (const row of screen.getAllByRole("menuitem")) {
      expect(row.className).toContain("min-h-[44px]");
    }
  });

  it("stays open on resize and blur", () => {
    const onClose = vi.fn();
    render(<ContextMenu items={ITEMS} position={{ x: 0, y: 0 }} onClose={onClose} />);
    // Android fires both for soft-keyboard and system-UI changes the user did
    // not initiate; dismissing on them would make the sheet vanish by itself.
    fireEvent.resize(window);
    fireEvent.blur(window);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("still closes on Escape (hardware keyboard attached)", () => {
    const onClose = vi.fn();
    render(<ContextMenu items={ITEMS} position={{ x: 0, y: 0 }} onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("expands submenus inline rather than as a flyout", () => {
    render(
      <ContextMenu
        items={[{ label: "Permissions", submenu: [{ label: "chmod 755", onClick: vi.fn() }] }]}
        position={{ x: 0, y: 0 }}
        onClose={vi.fn()}
      />,
    );
    const parent = screen.getByRole("menuitem", { name: /Permissions/ });
    expect(screen.queryByRole("menuitem", { name: "chmod 755" })).toBeNull();

    fireEvent.click(parent);

    // A flyout would need horizontal room the phone does not have.
    const child = screen.getByRole("menuitem", { name: "chmod 755" });
    expect(child).toBeInTheDocument();
    expect(child.className).toContain("min-h-[44px]");
    expect(parent).toHaveAttribute("aria-expanded", "true");
  });

  it("runs an item action and closes, same as the popover", () => {
    const onClick = vi.fn();
    const onClose = vi.fn();
    render(
      <ContextMenu
        items={[{ label: "Download", onClick }]}
        position={{ x: 0, y: 0 }}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Download" }));
    expect(onClick).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});
