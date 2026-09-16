import { useEffect, useRef, useState } from "react";
import {
  X,
  ChevronDown,
  TerminalSquare,
  FolderOpen,
  Cloud,
  Monitor,
  Braces,
  Plug,
  History,
  Settings,
  ArrowUpDown,
} from "lucide-react";
import {
  useTabStore,
  type UnifiedTab,
  type PageId,
} from "../../stores/tab-store";
import { useSessionStore, countPanes } from "../../stores/session-store";
import { closeTab, isCloseable } from "./close-tab";

/**
 * Compact session header for phones — replaces the horizontal tab strip.
 *
 * A scrolling tab strip costs a permanent row of vertical space and gives each
 * tab a tap target far under 44px. This shows only the *active* tab plus a
 * count, and expands into a full list on tap.
 */

const PAGE_ICONS: Record<PageId, React.ElementType> = {
  hosts: Monitor,
  snippets: Braces,
  "port-forwarding": Plug,
  history: History,
  settings: Settings,
  transfers: ArrowUpDown,
};

function getTabIcon(tab: UnifiedTab): React.ElementType {
  if (tab.type === "terminal") return TerminalSquare;
  if (tab.type === "sftp") return FolderOpen;
  if (tab.type === "s3") return Cloud;
  return PAGE_ICONS[tab.page] ?? Monitor;
}

/** Connection dot for terminal tabs; null for pages, which have no status. */
function useStatusDot(tab: UnifiedTab, tabId: string): string | null {
  const sessions = useSessionStore((s) => s.sessions);
  const termTabs = useSessionStore((s) => s.tabs);
  if (tab.type !== "terminal") return null;

  const termTab = termTabs.get(tabId);
  let node = termTab?.layout;
  while (node && node.type === "split") node = node.children[0];
  const status = node ? sessions.get(node.sessionId)?.status : undefined;

  return status === "Connected"
    ? "bg-status-connected"
    : status === "Connecting"
      ? "bg-status-connecting motion-safe:animate-pulse"
      : status === "Error"
        ? "bg-status-error"
        : "bg-status-disconnected";
}

function SessionRow({
  tabId,
  tab,
  isActive,
  onSelect,
}: {
  tabId: string;
  tab: UnifiedTab;
  isActive: boolean;
  onSelect: () => void;
}) {
  const Icon = getTabIcon(tab);
  const dot = useStatusDot(tab, tabId);
  const termTab = useSessionStore((s) => s.tabs.get(tabId));
  const paneCount = termTab ? countPanes(termTab.layout) : 1;

  return (
    <li className="flex items-stretch">
      <button
        type="button"
        data-testid={`session-row-${tabId}`}
        onClick={onSelect}
        aria-current={isActive ? "page" : undefined}
        className={[
          "flex-1 min-w-0 min-h-[48px] flex items-center gap-2.5 px-4 text-left",
          "transition-colors duration-[var(--duration-fast)]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
          isActive ? "bg-accent/10 text-accent" : "text-text-secondary",
        ].join(" ")}
      >
        <Icon
          size={16}
          strokeWidth={1.8}
          className={`shrink-0 ${isActive ? "text-accent" : "text-text-muted"}`}
          aria-hidden="true"
        />
        <span
          className={`truncate text-[length:var(--text-sm)] ${isActive ? "font-medium" : ""}`}
        >
          {tab.label}
        </span>
        {paneCount > 1 && (
          <span className="shrink-0 flex items-center justify-center min-w-[16px] h-[16px] px-1 rounded-lg bg-bg-muted text-[10px] font-bold text-text-secondary tabular-nums leading-none">
            {paneCount}
          </span>
        )}
        {dot && (
          <span
            className={`ml-auto shrink-0 w-2 h-2 rounded-full ${dot}`}
            aria-hidden="true"
          />
        )}
      </button>

      {isCloseable(tab) && (
        <button
          type="button"
          data-testid={`session-row-${tabId}-close`}
          onClick={() => void closeTab(tabId, tab)}
          aria-label={`Close ${tab.label}`}
          className="shrink-0 w-[48px] flex items-center justify-center text-text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <X size={16} strokeWidth={2} aria-hidden="true" />
        </button>
      )}
    </li>
  );
}

export function MobileSessionBar() {
  const tabOrder = useTabStore((s) => s.tabOrder);
  const tabs = useTabStore((s) => s.tabs);
  const activeTabId = useTabStore((s) => s.activeTabId);
  const setActiveTab = useTabStore((s) => s.setActiveTab);

  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const activeTab = activeTabId ? tabs.get(activeTabId) : null;

  // Collapse the drawer whenever the active tab changes — including changes
  // driven from elsewhere (connecting to a host opens a new tab), where
  // leaving the list covering the new session would be wrong.
  useEffect(() => {
    setOpen(false);
  }, [activeTabId]);

  // Escape closes. Deliberately no `blur`/`resize` handler: on Android both
  // fire when the soft keyboard or system UI appears, which would dismiss the
  // drawer out from under the user.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (tabOrder.length === 0 || !activeTab) return null;

  const ActiveIcon = getTabIcon(activeTab);
  const count = tabOrder.length;

  return (
    <div ref={rootRef} className="relative shrink-0 no-select">
      {/* Header — always visible. */}
      <div className="flex items-stretch border-b border-border/60 bg-bg-surface">
        <button
          type="button"
          data-testid="session-bar-toggle"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={`Open sessions (${count})`}
          className="flex-1 min-w-0 min-h-[44px] flex items-center gap-2 px-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <ActiveIcon
            size={15}
            strokeWidth={1.8}
            className="shrink-0 text-text-muted"
            aria-hidden="true"
          />
          <span className="truncate text-[length:var(--text-sm)] font-medium text-text-primary">
            {activeTab.label}
          </span>
          {count > 1 && (
            <span className="shrink-0 flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-bg-muted text-[length:var(--text-2xs)] font-bold text-text-secondary tabular-nums leading-none">
              {count}
            </span>
          )}
          <ChevronDown
            size={16}
            strokeWidth={2}
            className={`ml-auto shrink-0 text-text-muted transition-transform duration-[var(--duration-fast)] ${open ? "rotate-180" : ""}`}
            aria-hidden="true"
          />
        </button>

        {isCloseable(activeTab) && activeTabId && (
          <button
            type="button"
            data-testid="session-bar-close-active"
            onClick={() => void closeTab(activeTabId, activeTab)}
            aria-label={`Close ${activeTab.label}`}
            className="shrink-0 w-[44px] flex items-center justify-center text-text-muted border-l border-border/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            <X size={15} strokeWidth={2} aria-hidden="true" />
          </button>
        )}
      </div>

      {/* Drawer — overlays content rather than displacing it, so opening the
          list never resizes the terminal underneath (a reflow would force
          xterm to refit and reflow scrollback). */}
      {open && (
        <>
          <div
            data-testid="session-drawer-scrim"
            className="fixed inset-0 z-30 bg-black/40"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <ul
            data-testid="session-drawer"
            aria-label="Open sessions"
            className="absolute left-0 right-0 top-full z-40 max-h-[60vh] overflow-y-auto overscroll-contain bg-bg-overlay border-b border-border shadow-[var(--shadow-lg)]"
          >
            {tabOrder.map((tabId) => {
              const tab = tabs.get(tabId);
              if (!tab) return null;
              return (
                <SessionRow
                  key={tabId}
                  tabId={tabId}
                  tab={tab}
                  isActive={tabId === activeTabId}
                  onSelect={() => setActiveTab(tabId)}
                />
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
