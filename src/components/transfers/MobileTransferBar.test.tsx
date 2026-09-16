import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MobileTransferBar } from "./MobileTransferBar";
import { useTransferStore } from "../../stores/transfer-store";
import type { TransferEvent } from "../../types";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

function transfer(over: Partial<TransferEvent> = {}): TransferEvent {
  return {
    transfer_id: "t1",
    sftp_session_id: "s1",
    name: "big.iso",
    direction: "Download",
    status: "InProgress",
    error: null,
    bytes_transferred: 50,
    total_bytes: 100,
    files_done: 0,
    files_total: 1,
    speed_bps: 1000,
    eta_secs: 10,
    created_at: Date.now(),
    ...over,
  };
}

function seed(items: TransferEvent[]) {
  useTransferStore.setState({
    transfers: new Map(items.map((t) => [t.transfer_id, t])),
  });
}

describe("MobileTransferBar", () => {
  beforeEach(() => seed([]));

  it("stays out of the way when there are no transfers", () => {
    const { container } = render(<MobileTransferBar />);
    expect(container).toBeEmptyDOMElement();
  });

  it("summarises an in-flight download with byte-weighted progress", () => {
    seed([transfer()]);
    render(<MobileTransferBar />);

    const bar = screen.getByTestId("mobile-transfer-bar");
    expect(bar).toHaveTextContent("Downloading");
    expect(bar).toHaveTextContent("1 file (50%)");
  });

  it("weights progress by bytes, not by a mean of percentages", () => {
    // A tiny finished file must not drag a large barely-started one to ~50%.
    seed([
      transfer({ transfer_id: "a", bytes_transferred: 10, total_bytes: 10 }),
      transfer({ transfer_id: "b", bytes_transferred: 0, total_bytes: 990 }),
    ]);
    render(<MobileTransferBar />);

    // 10 / 1000 = 1%, not (100% + 0%) / 2 = 50%.
    expect(screen.getByTestId("mobile-transfer-bar")).toHaveTextContent("(1%)");
  });

  it("says Uploading when only uploads are running", () => {
    seed([transfer({ direction: "Upload" })]);
    render(<MobileTransferBar />);
    expect(screen.getByTestId("mobile-transfer-bar")).toHaveTextContent(
      "Uploading",
    );
  });

  it("says Transferring for a mixed queue", () => {
    seed([
      transfer({ transfer_id: "a", direction: "Upload" }),
      transfer({ transfer_id: "b", direction: "Download" }),
    ]);
    render(<MobileTransferBar />);
    expect(screen.getByTestId("mobile-transfer-bar")).toHaveTextContent(
      "Transferring",
    );
  });

  it("opens a bottom sheet listing the transfers", async () => {
    seed([transfer()]);
    const user = userEvent.setup();
    render(<MobileTransferBar />);

    await user.click(screen.getByTestId("mobile-transfer-bar"));

    expect(screen.getByTestId("transfer-sheet")).toBeInTheDocument();
    expect(screen.getByTestId("transfer-sheet")).toHaveAttribute(
      "aria-modal",
      "true",
    );
  });

  it("closes the sheet from the scrim and the close button", async () => {
    seed([transfer()]);
    const user = userEvent.setup();
    render(<MobileTransferBar />);

    await user.click(screen.getByTestId("mobile-transfer-bar"));
    await user.click(screen.getByTestId("transfer-sheet-scrim"));
    expect(screen.queryByTestId("transfer-sheet")).not.toBeInTheDocument();

    await user.click(screen.getByTestId("mobile-transfer-bar"));
    await user.click(screen.getByTestId("transfer-sheet-close"));
    expect(screen.queryByTestId("transfer-sheet")).not.toBeInTheDocument();
  });

  it("reports finished transfers without a percentage", () => {
    seed([transfer({ status: "Completed", bytes_transferred: 100 })]);
    render(<MobileTransferBar />);

    const bar = screen.getByTestId("mobile-transfer-bar");
    expect(bar).toHaveTextContent("Transfers");
    expect(bar).toHaveTextContent("1 finished");
    expect(bar).not.toHaveTextContent("%");
  });

  it("clears the safe-area inset so the sheet escapes the gesture bar", async () => {
    seed([transfer()]);
    const user = userEvent.setup();
    render(<MobileTransferBar />);

    await user.click(screen.getByTestId("mobile-transfer-bar"));
    expect(screen.getByTestId("transfer-sheet").className).toContain(
      "pb-[env(safe-area-inset-bottom)]",
    );
  });
});
