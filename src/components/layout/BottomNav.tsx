import { Monitor, FolderOpen, Braces, Settings } from "lucide-react";
import { useTabStore, type PageId } from "../../stores/tab-store";

/**
 * Bottom navigation bar — the mobile counterpart to the desktop `Sidebar`.
 *
 * Only ever mounted below `sm` (see `AppShell`), and deliberately so rather
 * than hidden with a `hidden sm:flex` class: the desktop e2e suite locates
 * navigation by `aria-label` (`[aria-label='Hosts']`, `'Settings'`,
 * `'Tunnels'`) and WebdriverIO's `$()` returns the *first* DOM match. A
 * CSS-hidden bottom nav would shadow the sidebar with a non-clickable node and
 * break those specs. Mounting exclusively also keeps screen readers from
 * announcing every destination twice.
 */

interface BottomNavItem {
  id: string;
  icon: React.ElementType;
  label: string;
  /** Opens a page tab. */
  page?: PageId;
  /** Activates the most recent session tab of these types, in order. */
  sessionTypes?: ("sftp" | "s3")[];
}

// Four destinations only. A bottom bar stops being tappable past five, and
// Tunnels/History stay reachable from the Hosts screen rather than competing
// for a slot here.
const ITEMS: BottomNavItem[] = [
  { id: "hosts", icon: Monitor, label: "Hosts", page: "hosts" },
  { id: "sftp", icon: FolderOpen, label: "Files", sessionTypes: ["sftp", "s3"] },
  { id: "snippets", icon: Braces, label: "Snippets", page: "snippets" },
  { id: "settings", icon: Settings, label: "Settings", page: "settings" },
];

export function BottomNav() {
  const activeTab = useTabStore((s) =>
    s.activeTabId ? s.tabs.get(s.activeTabId) : null,
  );
  const openPageTab = useTabStore((s) => s.openPageTab);
  const activateRecent = useTabStore((s) => s.activateRecentTabOfType);
  const tabs = useTabStore((s) => s.tabs);

  // Is there any file-browser session to switch to? Without one the Files
  // button would be a dead tap, so it is disabled and says why.
  const hasExplorerSession = Array.from(tabs.values()).some(
    (t) => t.type === "sftp" || t.type === "s3",
  );

  const activeId = (() => {
    if (!activeTab) return null;
    if (activeTab.type === "sftp" || activeTab.type === "s3") return "sftp";
    if (activeTab.type === "page") return activeTab.page;
    // Terminal tabs match no bottom-nav destination; nothing is highlighted.
    return null;
  })();

  const handleClick = (item: BottomNavItem) => {
    if (item.page) {
      openPageTab(item.page, item.label);
      return;
    }
    for (const type of item.sessionTypes ?? []) {
      if (activateRecent(type)) return;
    }
  };

  return (
    <nav
      data-testid="bottom-nav"
      aria-label="Main navigation"
      className={[
        "shrink-0 flex items-stretch justify-around",
        "border-t border-border/60 bg-bg-surface",
        // Clear Android's gesture bar / iOS home indicator. Resolves to 0 where
        // there is no inset, so the bar keeps its natural height.
        "pb-[env(safe-area-inset-bottom)]",
        "no-select",
      ].join(" ")}
    >
      {ITEMS.map((item) => {
        const isActive = activeId === item.id;
        const disabled = !!item.sessionTypes && !hasExplorerSession;
        const Icon = item.icon;

        return (
          <button
            key={item.id}
            type="button"
            data-testid={`bottom-nav-${item.id}`}
            onClick={() => handleClick(item)}
            disabled={disabled}
            aria-label={item.label}
            aria-current={isActive ? "page" : undefined}
            title={
              disabled ? "Connect to a host to browse files" : item.label
            }
            className={[
              // 44px floor on both axes (WCAG 2.5.5); flex-1 spreads the row.
              "flex-1 min-w-[44px] min-h-[52px] flex flex-col items-center justify-center gap-0.5 px-1 py-1.5",
              "transition-colors duration-[var(--duration-fast)]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
              "disabled:opacity-40",
              isActive ? "text-accent" : "text-text-secondary",
            ].join(" ")}
          >
            <Icon
              size={20}
              strokeWidth={isActive ? 2 : 1.6}
              className={isActive ? "text-accent" : "text-text-muted"}
              aria-hidden="true"
            />
            <span
              className={[
                "text-[length:var(--text-2xs)] leading-none truncate max-w-full",
                isActive ? "font-semibold" : "font-medium",
              ].join(" ")}
            >
              {item.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
