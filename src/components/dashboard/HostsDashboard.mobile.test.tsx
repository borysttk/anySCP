import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { SavedHost } from "../../types";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue([]),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
  emit: vi.fn().mockResolvedValue(undefined),
}));

import { HostsDashboard } from "./HostsDashboard";
import { useHostsStore } from "../../stores/hosts-store";
import { useGroupsStore } from "../../stores/groups-store";
import { useS3Store } from "../../stores/s3-store";

function mockViewport(mobile: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: query.includes("max-width") ? mobile : !mobile,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

function host(id: string, label: string): SavedHost {
  return {
    id,
    label,
    host: `${label}.example.com`,
    port: 22,
    username: "root",
    auth_type: "password",
    group_id: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    key_path: null,
    color: null,
    notes: null,
    environment: null,
    os_type: null,
    startup_command: null,
    proxy_jump: null,
    proxy_jump_host_id: null,
    start_directory: null,
    keep_alive_interval: null,
    default_shell: null,
    font_size: null,
    last_connected_at: null,
  } as SavedHost;
}

const origRO = globalThis.ResizeObserver;

beforeEach(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;

  useHostsStore.setState({ hosts: [host("h1", "alpha"), host("h2", "beta")] });
  useGroupsStore.setState({ groups: [] });
  useS3Store.setState({ connections: [] });
});

afterEach(() => {
  globalThis.ResizeObserver = origRO;
  delete (window as Partial<Window>).matchMedia;
});

describe("HostsDashboard — mobile layout", () => {
  it("stacks host cards in one column below sm and restores the grid above", () => {
    mockViewport(true);
    const { container } = render(<HostsDashboard />);

    const grids = container.querySelectorAll("[class*='grid-cols-1']");
    expect(grids.length).toBeGreaterThan(0);
    for (const g of grids) {
      // The desktop three-column grid must survive as an `sm:` escape hatch.
      expect(g.className).toContain("sm:grid-cols-3");
    }
  });

  it("keeps the search field reachable while scrolling", () => {
    mockViewport(true);
    render(<HostsDashboard />);

    const wrapper = screen.getByTestId("host-search").parentElement!;
    expect(wrapper.className).toContain("sticky");
    // …but never on desktop, where the page is short and a sticky bar would
    // just eat vertical space.
    expect(wrapper.className).toContain("sm:static");
  });

  it("offers a thumb-reachable FAB on mobile", () => {
    mockViewport(true);
    render(<HostsDashboard />);

    const fab = screen.getByTestId("new-host-fab");
    expect(fab).toBeInTheDocument();
    // Must clear the BottomNav and the Android gesture inset.
    expect(fab.className).toContain(
      "bottom-[calc(1rem+56px+env(safe-area-inset-bottom))]",
    );
  });

  it("has no FAB on desktop", () => {
    mockViewport(false);
    render(<HostsDashboard />);
    expect(screen.queryByTestId("new-host-fab")).not.toBeInTheDocument();
  });

  it("never shows two controls named 'New Server' at one breakpoint", () => {
    // The FAB replaces the toolbar button on mobile rather than joining it:
    // two identically-named buttons would be announced twice by a screen
    // reader and make a name-based selector ambiguous.
    //
    // Asserted through the class contract, not getAllByRole. jsdom applies no
    // stylesheets, so a `hidden` node stays in its accessibility tree — in a
    // real browser `.hidden{display:none}` (verified unconditional in the
    // built CSS, with `.sm\:flex` scoped to `@media(min-width:40rem)`) drops
    // it from the tree entirely.
    mockViewport(true);
    const { unmount } = render(<HostsDashboard />);

    const named = screen.getAllByRole("button", { name: /New Server/i });
    expect(named).toHaveLength(2); // both in the DOM…
    // …but exactly one is visible at this breakpoint.
    const hiddenOnMobile = named.filter((b) => b.className.includes("hidden"));
    expect(hiddenOnMobile).toHaveLength(1);
    expect(hiddenOnMobile[0]).toHaveAttribute("data-testid", "new-host-button");
    unmount();

    // Desktop renders the toolbar button and no FAB at all, so there is only
    // ever one node to begin with.
    mockViewport(false);
    render(<HostsDashboard />);
    expect(screen.getAllByRole("button", { name: /New Server/i })).toHaveLength(1);
  });

  it("keeps the new-host-button testid mounted for the desktop e2e suite", () => {
    // Specs resolve it by testid; `hidden` keeps the node in the DOM, and the
    // desktop viewport must still render it visibly.
    mockViewport(false);
    render(<HostsDashboard />);
    const btn = screen.getByTestId("new-host-button");
    expect(btn).toBeInTheDocument();
    expect(btn.className).toContain("sm:flex");
  });

  it("reserves scroll room so the FAB cannot cover the last card", () => {
    mockViewport(true);
    const { container } = render(<HostsDashboard />);
    const inner = container.querySelector(".max-w-4xl") as HTMLElement;
    expect(inner.className).toContain("pb-28");
  });
});
