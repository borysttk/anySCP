import "@testing-library/jest-dom/vitest";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ExplorerToolbar } from "./ExplorerToolbar";
import { createSftpProvider } from "../../providers/sftp-provider";

/**
 * Deep paths (/var/www/app/storage/logs) overflow the breadcrumb on a phone.
 * The bar scrolls horizontally, and must auto-scroll to its right edge so the
 * *current* directory is what stays visible — otherwise a narrow screen shows
 * only the uninformative root end of the path.
 */

function segmentsFor(path: string) {
  const raw = path.split("/").filter(Boolean);
  return [
    { label: "/", path: "/" },
    ...raw.map((seg, i) => ({
      label: seg,
      path: "/" + raw.slice(0, i + 1).join("/"),
    })),
  ];
}

function renderToolbar(path: string) {
  return render(
    <ExplorerToolbar
      provider={createSftpProvider("s")}
      currentPath={path}
      segments={segmentsFor(path)}
      loading={false}
      onNavigate={() => {}}
      onRefresh={() => {}}
      onNewFile={() => {}}
      onNewFolder={() => {}}
      onUpload={() => {}}
      onUploadFolder={() => {}}
      busy={false}
    />,
  );
}

const DEEP = "/var/www/app/storage/logs";

describe("ExplorerToolbar — breadcrumb overflow", () => {
  it("keeps segments on one line and hides the scrollbar", () => {
    renderToolbar(DEEP);
    const bar = screen.getByTestId("explorer-breadcrumb");

    expect(bar.className).toContain("overflow-x-auto");
    expect(bar.className).toContain("whitespace-nowrap");
    // A visible scrollbar would eat height in an already short 40px row.
    expect(bar.className).toContain("[&::-webkit-scrollbar]:hidden");
  });

  it("scrolls to the current directory when the path changes", () => {
    const { rerender } = renderToolbar("/var");
    const bar = screen.getByTestId("explorer-breadcrumb");

    // jsdom reports 0 for every layout metric, so drive the scroll maths with
    // a stubbed scrollWidth — the assertion is that the effect writes the
    // right-hand extreme into scrollLeft, not what that number happens to be.
    Object.defineProperty(bar, "scrollWidth", {
      configurable: true,
      value: 800,
    });
    bar.scrollLeft = 0;

    rerender(
      <ExplorerToolbar
        provider={createSftpProvider("s")}
        currentPath={DEEP}
        segments={segmentsFor(DEEP)}
        loading={false}
        onNavigate={() => {}}
        onRefresh={() => {}}
        onNewFile={() => {}}
        onNewFolder={() => {}}
        onUpload={() => {}}
        onUploadFolder={() => {}}
        busy={false}
      />,
    );

    expect(bar.scrollLeft).toBe(800);
  });

  it("renders every path segment as its own control", () => {
    renderToolbar(DEEP);
    for (const label of ["var", "www", "app", "storage", "logs"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
  });

  it("gives segments a touch-sized hit area that collapses on desktop", () => {
    renderToolbar(DEEP);
    // One- and two-character directory names are otherwise nearly untappable.
    const seg = screen.getByRole("button", { name: "www" });
    expect(seg.className).toContain("px-2");
    expect(seg.className).toContain("sm:px-1");
  });

  it("disables the last segment — it is the current directory", () => {
    renderToolbar(DEEP);
    expect(screen.getByRole("button", { name: "logs" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "storage" })).toBeEnabled();
  });
});
