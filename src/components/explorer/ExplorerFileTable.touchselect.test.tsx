import "@testing-library/jest-dom/vitest";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ExplorerFileTable } from "./ExplorerFileTable";
import { createSftpProvider } from "../../providers/sftp-provider";
import type { ExplorerEntry } from "../../types/explorer";

/**
 * Multi-select previously required Ctrl/Cmd- or Shift-click, which a
 * touchscreen cannot produce. The existing bulk actions (Download / Delete /
 * Permissions over a selection) were therefore single-file-only on a phone.
 * These tests pin the touch-only checkbox that closes that gap.
 */

function entry(over: Partial<ExplorerEntry> = {}): ExplorerEntry {
  return {
    name: "notes.txt",
    id: "/home/notes.txt",
    entryType: "File",
    size: 12,
    modified: null,
    permissionsDisplay: "rw-r--r--",
    permissions: 0o644,
    isSymlink: false,
    storageClass: null,
    ...over,
  };
}

const ENTRIES: ExplorerEntry[] = [
  entry({ name: "a.txt", id: "/home/a.txt" }),
  entry({ name: "b.txt", id: "/home/b.txt" }),
  entry({ name: "c.txt", id: "/home/c.txt" }),
];

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

function renderTable() {
  return render(
    <ExplorerFileTable
      provider={createSftpProvider("s")}
      entries={ENTRIES}
      sortBy="name"
      sortAsc
      onSortChange={() => {}}
      clipboard={null}
      onSetClipboard={() => {}}
      onNavigate={() => {}}
      onDownload={() => {}}
      onDelete={async () => {}}
      onEditInEditor={() => {}}
      currentPath="/home"
      loading={false}
    />,
  );
}

afterEach(() => {
  delete (window as Partial<Window>).matchMedia;
});

describe("ExplorerFileTable — touch multi-select", () => {
  it("shows a checkbox per row on touch viewports", () => {
    mockViewport(true);
    renderTable();
    for (const name of ["a.txt", "b.txt", "c.txt"]) {
      expect(screen.getByTestId(`explorer-select-${name}`)).toBeInTheDocument();
    }
  });

  it("keeps checkboxes off desktop, where Ctrl/Shift-click already works", () => {
    mockViewport(false);
    renderTable();
    expect(screen.queryByTestId("explorer-select-a.txt")).not.toBeInTheDocument();
  });

  it("accumulates a multi-file selection across taps", () => {
    mockViewport(true);
    renderTable();

    fireEvent.click(screen.getByTestId("explorer-select-a.txt"));
    fireEvent.click(screen.getByTestId("explorer-select-c.txt"));

    expect(screen.getByTestId("explorer-select-a.txt")).toBeChecked();
    expect(screen.getByTestId("explorer-select-b.txt")).not.toBeChecked();
    expect(screen.getByTestId("explorer-select-c.txt")).toBeChecked();
  });

  it("unticks without clearing the rest of the selection", () => {
    mockViewport(true);
    renderTable();

    fireEvent.click(screen.getByTestId("explorer-select-a.txt"));
    fireEvent.click(screen.getByTestId("explorer-select-b.txt"));
    fireEvent.click(screen.getByTestId("explorer-select-a.txt"));

    expect(screen.getByTestId("explorer-select-a.txt")).not.toBeChecked();
    expect(screen.getByTestId("explorer-select-b.txt")).toBeChecked();
  });

  it("does not let a checkbox tap also trigger the row's tap action", () => {
    mockViewport(true);
    renderTable();

    // A plain row click replaces the selection with just that row. If the
    // checkbox click bubbled, ticking a second box would collapse the
    // selection back to one — so two boxes staying ticked proves the row
    // handler did not run.
    fireEvent.click(screen.getByTestId("explorer-select-a.txt"));
    fireEvent.click(screen.getByTestId("explorer-select-b.txt"));

    expect(screen.getByTestId("explorer-select-a.txt")).toBeChecked();
    expect(screen.getByTestId("explorer-select-b.txt")).toBeChecked();
  });

  it("labels each checkbox with its file name", () => {
    mockViewport(true);
    renderTable();
    expect(
      screen.getByRole("checkbox", { name: "Select b.txt" }),
    ).toBeInTheDocument();
  });
});
