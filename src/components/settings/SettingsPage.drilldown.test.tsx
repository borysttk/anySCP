import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SettingsPage } from "./SettingsPage";

/**
 * The mobile drill-down is implemented with breakpoint classes, not a JS
 * viewport check, so these tests assert on the class contract rather than on
 * computed layout (jsdom does not evaluate media queries).
 *
 * The invariant that matters: whatever `detailOpen` is, both panes carry an
 * `sm:` escape hatch, so the desktop two-pane layout is never hidden. The
 * desktop e2e suite clicks `settings-nav-*` directly and would break if a
 * pane were ever unconditionally `hidden`.
 */

const nav = () => screen.getByRole("navigation", { name: "Settings sections" });
const detailPane = () => {
  const pane = screen
    .getByRole("heading", { level: 1 })
    .closest("div[class*='overflow-y-scroll']");
  if (!pane) throw new Error("detail pane not found — scroll container markup changed");
  return pane;
};

describe("SettingsPage drill-down", () => {
  it("shows the category list and keeps the detail pane desktop-visible at level 1", () => {
    render(<SettingsPage />);

    // Level 1: nav visible unconditionally.
    expect(nav().className).toContain("flex");
    expect(nav().className).not.toContain("hidden");

    // Detail pane hidden on mobile but restored at `sm`.
    const pane = detailPane();
    expect(pane.className).toContain("hidden");
    expect(pane.className).toContain("sm:block");
  });

  it("swaps the panes after selecting a category, keeping both sm-visible", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    render(<SettingsPage />);

    await user.click(screen.getByTestId("settings-nav-terminal"));

    // Level 2: nav collapses on mobile, returns at `sm`.
    expect(nav().className).toContain("hidden");
    expect(nav().className).toContain("sm:flex");

    // Detail pane now unconditionally shown.
    const pane = detailPane();
    expect(pane.className).toContain("block");
    expect(pane.className).not.toContain("hidden");
  });

  it("returns to the category list via the back button", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    render(<SettingsPage />);

    await user.click(screen.getByTestId("settings-nav-data"));
    expect(nav().className).toContain("hidden");

    await user.click(screen.getByTestId("settings-back"));
    expect(nav().className).not.toContain("hidden");
  });

  it("hides the back button from `sm` up so desktop never sees it", () => {
    render(<SettingsPage />);
    expect(screen.getByTestId("settings-back").className).toContain("sm:hidden");
  });

  it("keeps every settings-nav testid mounted for the desktop e2e suite", () => {
    render(<SettingsPage />);
    for (const id of [
      "appearance",
      "terminal",
      "explorer",
      "transfers",
      "editors",
      "data",
      "about",
    ]) {
      expect(screen.getByTestId(`settings-nav-${id}`)).toBeInTheDocument();
    }
  });
});
