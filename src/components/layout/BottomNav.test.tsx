import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BottomNav } from "./BottomNav";
import { useTabStore, pageTabId, type UnifiedTab } from "../../stores/tab-store";

const HOSTS = pageTabId("hosts");

function resetTabs(extra: UnifiedTab[] = []) {
  const tabs = new Map<string, UnifiedTab>([
    [HOSTS, { type: "page", id: HOSTS, label: "Hosts", page: "hosts" }],
  ]);
  for (const t of extra) tabs.set(t.id, t);
  useTabStore.setState({
    tabs,
    tabOrder: [HOSTS, ...extra.map((t) => t.id)],
    activeTabId: HOSTS,
  });
}

describe("BottomNav", () => {
  beforeEach(() => resetTabs());

  it("exposes four destinations with 44px-plus touch targets", () => {
    render(<BottomNav />);
    for (const label of ["Hosts", "Files", "Snippets", "Settings"]) {
      const btn = screen.getByRole("button", { name: label });
      expect(btn).toBeInTheDocument();
      // WCAG 2.5.5 / Android 48dp. jsdom has no layout, so the class contract
      // is what we can assert.
      expect(btn.className).toMatch(/min-h-\[52px\]/);
      expect(btn.className).toMatch(/min-w-\[44px\]/);
    }
  });

  it("marks the destination matching the active tab", () => {
    render(<BottomNav />);
    expect(screen.getByRole("button", { name: "Hosts" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("button", { name: "Settings" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("opens a page tab when a destination is tapped", async () => {
    const user = userEvent.setup();
    render(<BottomNav />);

    await user.click(screen.getByRole("button", { name: "Snippets" }));

    expect(useTabStore.getState().activeTabId).toBe(pageTabId("snippets"));
  });

  it("disables Files while no explorer session exists", () => {
    render(<BottomNav />);
    const files = screen.getByRole("button", { name: "Files" });
    expect(files).toBeDisabled();
    expect(files).toHaveAttribute("title", "Connect to a host to browse files");
  });

  it("activates the most recent explorer session when Files is tapped", async () => {
    resetTabs([
      { type: "sftp", id: "sftp-1", label: "server-a" },
      { type: "sftp", id: "sftp-2", label: "server-b" },
    ]);
    const user = userEvent.setup();
    render(<BottomNav />);

    const files = screen.getByRole("button", { name: "Files" });
    expect(files).toBeEnabled();
    await user.click(files);

    // Most recent wins — activateRecentTabOfType walks tabOrder backwards.
    expect(useTabStore.getState().activeTabId).toBe("sftp-2");
  });

  it("falls back to an S3 session when there is no SFTP tab", async () => {
    resetTabs([{ type: "s3", id: "s3-1", label: "bucket" }]);
    const user = userEvent.setup();
    render(<BottomNav />);

    await user.click(screen.getByRole("button", { name: "Files" }));

    expect(useTabStore.getState().activeTabId).toBe("s3-1");
  });

  it("highlights Files for both sftp and s3 tabs", () => {
    resetTabs([{ type: "s3", id: "s3-1", label: "bucket" }]);
    useTabStore.setState({ activeTabId: "s3-1" });
    render(<BottomNav />);

    expect(screen.getByRole("button", { name: "Files" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("highlights nothing while a terminal tab is active", () => {
    resetTabs([{ type: "terminal", id: "term-1", label: "root@box" }]);
    useTabStore.setState({ activeTabId: "term-1" });
    render(<BottomNav />);

    for (const label of ["Hosts", "Files", "Snippets", "Settings"]) {
      expect(screen.getByRole("button", { name: label })).not.toHaveAttribute(
        "aria-current",
      );
    }
  });

  it("reserves room for the Android gesture bar", () => {
    render(<BottomNav />);
    expect(screen.getByTestId("bottom-nav").className).toContain(
      "pb-[env(safe-area-inset-bottom)]",
    );
  });
});
