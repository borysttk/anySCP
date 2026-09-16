import { useEffect, useState } from "react";
import { ChevronUp, X } from "lucide-react";
import { useTransfers } from "../../hooks/use-transfers";
import { TransferList } from "./TransferList";
import { getStatusString } from "../../utils/format";

/**
 * Compact transfer indicator for phones, plus the bottom sheet it opens.
 *
 * Fills a real gap rather than just saving space: `TransferPopover` is rendered
 * only by `Sidebar`, and `Sidebar` is desktop-only, so without this the
 * transfer queue is unreachable on mobile — no way to cancel, retry or dismiss
 * anything once it is running.
 *
 * Renders nothing when there is no transfer to talk about, so it costs no
 * vertical space in the common case.
 */
export function MobileTransferBar() {
  const { list, activeCount, queuedCount, onCancel, onRetry, onDismiss } =
    useTransfers();
  const [open, setOpen] = useState(false);

  // Aggregate progress across everything still running. Byte-weighted rather
  // than a mean of percentages, so one small file finishing early cannot make
  // a large concurrent upload look nearly done.
  const running = list.filter((t) => {
    const s = getStatusString(t.status);
    return s === "InProgress" || s === "Queued";
  });

  const totalBytes = running.reduce((n, t) => n + t.total_bytes, 0);
  const doneBytes = running.reduce((n, t) => n + t.bytes_transferred, 0);
  const pct =
    totalBytes > 0 ? Math.min(100, Math.round((doneBytes / totalBytes) * 100)) : 0;

  const inFlight = activeCount + queuedCount;

  // Close the sheet once the queue drains — leaving an empty sheet covering the
  // file list would be a dead end the user has to dismiss by hand.
  useEffect(() => {
    if (inFlight === 0 && list.length === 0) setOpen(false);
  }, [inFlight, list.length]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (list.length === 0) return null;

  // Direction wording follows the running items; falls back to a neutral
  // summary once everything has finished but the rows are still listed.
  const downloads = running.filter((t) => t.direction === "Download").length;
  const uploads = running.length - downloads;
  const verb =
    inFlight === 0
      ? "Transfers"
      : uploads === 0
        ? "Downloading"
        : downloads === 0
          ? "Uploading"
          : "Transferring";

  const summary =
    inFlight === 0
      ? `${list.length} finished`
      : `${inFlight} ${inFlight === 1 ? "file" : "files"} (${pct}%)`;

  return (
    <>
      <button
        type="button"
        data-testid="mobile-transfer-bar"
        onClick={() => setOpen(true)}
        aria-expanded={open}
        aria-label={`${verb}: ${summary}. Open transfer list`}
        className={[
          "relative shrink-0 w-full min-h-[44px] flex items-center gap-2 px-4",
          "border-t border-border/60 bg-bg-surface text-left",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        ].join(" ")}
      >
        <span className="text-[length:var(--text-sm)] font-medium text-text-primary truncate">
          {verb}
        </span>
        <span className="text-[length:var(--text-xs)] text-text-muted truncate">
          {summary}
        </span>
        <ChevronUp
          size={16}
          strokeWidth={2}
          className="ml-auto shrink-0 text-text-muted"
          aria-hidden="true"
        />

        {/* Progress rail along the bottom edge of the bar. */}
        {inFlight > 0 && (
          <span
            className="absolute bottom-0 left-0 h-0.5 bg-accent transition-[width] duration-[var(--duration-base)]"
            style={{ width: `${pct}%` }}
            aria-hidden="true"
          />
        )}
      </button>

      {open && (
        <>
          <div
            data-testid="transfer-sheet-scrim"
            className="fixed inset-0 z-40 bg-black/40"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div
            data-testid="transfer-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Transfers"
            className={[
              "fixed inset-x-0 bottom-0 z-50 flex flex-col",
              "max-h-[70vh] rounded-t-xl bg-bg-overlay border-t border-border",
              "shadow-[var(--shadow-lg)]",
              "pb-[env(safe-area-inset-bottom)]",
            ].join(" ")}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
              <h2 className="text-[length:var(--text-sm)] font-semibold text-text-primary">
                Transfers
              </h2>
              <button
                type="button"
                data-testid="transfer-sheet-close"
                onClick={() => setOpen(false)}
                aria-label="Close transfers"
                className="flex items-center justify-center h-11 w-11 -mr-2 rounded-md text-text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X size={16} strokeWidth={2} aria-hidden="true" />
              </button>
            </div>

            <div className="overflow-y-auto overscroll-contain min-h-0">
              <TransferList
                list={list}
                onCancel={onCancel}
                onRetry={onRetry}
                onDismiss={onDismiss}
              />
            </div>
          </div>
        </>
      )}
    </>
  );
}
