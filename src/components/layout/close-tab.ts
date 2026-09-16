import type { UnifiedTab } from "../../stores/tab-store";
import { useTabStore } from "../../stores/tab-store";
import { useSessionStore } from "../../stores/session-store";
import type { LayoutNode } from "../../types";

/**
 * Tear down a tab's backing session(s) and remove it from the tab bar.
 *
 * Extracted from `UnifiedTabBar` so the desktop tab strip and the mobile
 * session drawer close tabs through exactly one code path — a terminal tab
 * closed from the drawer must disconnect every pane in its split layout, which
 * is easy to get subtly wrong in a second copy.
 *
 * Every `invoke` is best-effort: a session that is already gone (dropped
 * connection, remote hangup) must still leave the UI, so backend errors are
 * swallowed and the store cleanup always runs.
 */
export async function closeTab(tabId: string, tab: UnifiedTab): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");

  if (tab.type === "terminal") {
    const termTab = useSessionStore.getState().tabs.get(tabId);
    if (termTab) {
      for (const sid of collectLayoutIds(termTab.layout)) {
        try {
          await invoke("ssh_disconnect", { sessionId: sid });
        } catch {
          /* already disconnected */
        }
        useSessionStore.getState().removeSession(sid);
      }
    }
  } else if (tab.type === "sftp") {
    try {
      await invoke("sftp_close", { sftpSessionId: tabId });
    } catch {
      /* ok */
    }
    const { useSftpStore } = await import("../../stores/sftp-store");
    useSftpStore.getState().closeSession(tabId);
  } else if (tab.type === "s3") {
    try {
      await invoke("s3_disconnect", { s3SessionId: tabId });
    } catch {
      /* ok */
    }
    const { useS3Store } = await import("../../stores/s3-store");
    useS3Store.getState().closeSession(tabId);
  }

  useTabStore.getState().removeTab(tabId);
}

/** Depth-first collection of every session id in a (possibly split) layout. */
export function collectLayoutIds(node: LayoutNode): string[] {
  if (node.type === "pane") return [node.sessionId];
  return [
    ...collectLayoutIds(node.children[0]),
    ...collectLayoutIds(node.children[1]),
  ];
}

/** The Hosts page tab is permanent — it has no close affordance. */
export function isCloseable(tab: UnifiedTab): boolean {
  return !(tab.type === "page" && tab.page === "hosts");
}
