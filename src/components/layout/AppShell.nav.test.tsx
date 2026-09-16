import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { useTabStore, pageTabId } from "../../stores/tab-store";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
  emit: vi.fn().mockResolvedValue(undefined),
}));

// Page bodies are stubbed: this suite is about the shell's chrome (which nav
// is mounted, how the frame is laid out), and the real dashboard needs a
// populated host store that has nothing to do with that.
vi.mock("../dashboard", () => ({
  HostsDashboard: () => <div data-testid="stub-hosts" />,
  HostEditModal: () => null,
}));
vi.mock("../snippets", () => ({ SnippetsPage: () => null }));
vi.mock("../snippets/SnippetPalette", () => ({ SnippetPalette: () => null }));
vi.mock("../settings", () => ({ SettingsPage: () => null }));
vi.mock("../sftp", () => ({ ExplorerPage: () => null }));
vi.mock("../port-forwarding", () => ({ PortForwardingPage: () => null }));
vi.mock("../history", () => ({ HistoryPage: () => null }));
vi.mock("../transfers", () => ({ TransfersPage: () => null }));
vi.mock("../updater/UpdateDialog", () => ({ UpdateDialog: () => null }));
vi.mock("../terminal", () => ({ TerminalArea: () => null }));

import { AppShell } from "./AppShell";

/**
 * Guards the single most breakable property of the mobile shell: the desktop
 * sidebar and the mobile bottom nav must never be in the DOM at the same time.
 *
 * Both expose `aria-label="Hosts"`, `"Settings"` and friends, and the
 * WebdriverIO e2e suite resolves navigation with `$("[aria-label='Hosts']")`,
 * which takes the FIRST match. If a CSS-hidden bottom nav were rendered on
 * desktop it would shadow the sidebar with an unclickable element and take out
 * specs 23, 28, 61 and 62 — with a failure mode ("element not interactable")
 * that points nowhere near this file.
 */

function mockViewport(mobile: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: mobile && query.includes("max-width"),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

const origRO = globalThis.ResizeObserver;

beforeEach(() => {
  // jsdom ships neither; UnifiedTabBar observes its scroll container and the
  // terminal area measures itself.
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  // jsdom implements no layout, so scrollIntoView is absent; the tab strip
  // calls it to keep the active tab visible.
  Element.prototype.scrollIntoView = () => {};

  const HOSTS = pageTabId("hosts");
  useTabStore.setState({
    tabs: new Map([
      [HOSTS, { type: "page", id: HOSTS, label: "Hosts", page: "hosts" }],
    ]),
    tabOrder: [HOSTS],
    activeTabId: HOSTS,
  });
});

afterEach(() => {
  globalThis.ResizeObserver = origRO;
  delete (window as Partial<Window>).matchMedia;
});

describe("AppShell navigation", () => {
  it("renders only the sidebar on desktop", () => {
    mockViewport(false);
    render(<AppShell />);

    expect(screen.getByTestId("sidebar")).toBeInTheDocument();
    expect(screen.queryByTestId("bottom-nav")).not.toBeInTheDocument();
  });

  it("renders only the bottom nav on mobile", () => {
    mockViewport(true);
    render(<AppShell />);

    expect(screen.getByTestId("bottom-nav")).toBeInTheDocument();
    expect(screen.queryByTestId("sidebar")).not.toBeInTheDocument();
  });

  it("never duplicates a nav aria-label, in either mode", () => {
    for (const mobile of [false, true]) {
      mockViewport(mobile);
      const { unmount } = render(<AppShell />);

      // getAllByLabelText throws on zero matches, so a length check alone is
      // enough to prove there is exactly one of each.
      for (const label of ["Hosts", "Settings"]) {
        expect(
          screen.getAllByLabelText(label, { selector: "button" }),
          `${label} duplicated on ${mobile ? "mobile" : "desktop"}`,
        ).toHaveLength(1);
      }
      unmount();
    }
  });

  it("swaps the tab strip for the compact session bar on mobile", () => {
    mockViewport(true);
    render(<AppShell />);

    expect(screen.getByTestId("session-bar-toggle")).toBeInTheDocument();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
  });

  it("keeps the desktop tab strip on wide viewports", () => {
    mockViewport(false);
    render(<AppShell />);

    expect(screen.getByRole("tablist")).toBeInTheDocument();
    expect(screen.queryByTestId("session-bar-toggle")).not.toBeInTheDocument();
  });

  it("stacks vertically and honours the top safe-area inset on mobile", () => {
    mockViewport(true);
    const { container } = render(<AppShell />);

    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain("flex-col");
    expect(root.className).toContain("pt-[env(safe-area-inset-top)]");
  });

  it("keeps the desktop window padding and row layout on wide viewports", () => {
    mockViewport(false);
    const { container } = render(<AppShell />);

    const root = container.firstElementChild as HTMLElement;
    expect(root.className).not.toContain("flex-col");
    expect(root.className).toContain("p-2");
  });

  it("gives the content column min-h-0 so children can own the leftover space", () => {
    mockViewport(true);
    const { container } = render(<AppShell />);

    // Without min-h-0 a flex child refuses to shrink below its content height,
    // and the terminal would push the bottom nav off-screen.
    const column = container.querySelector(".flex-col.flex-1");
    expect(column?.className).toContain("min-h-0");
  });
});
