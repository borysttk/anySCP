import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MobileSessionBar } from "./MobileSessionBar";
import { useTabStore, pageTabId, type UnifiedTab } from "../../stores/tab-store";

const invoke = vi.fn().mockResolvedValue(undefined);
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));

const HOSTS = pageTabId("hosts");

function resetTabs(extra: UnifiedTab[] = [], activeId = HOSTS) {
  const tabs = new Map<string, UnifiedTab>([
    [HOSTS, { type: "page", id: HOSTS, label: "Hosts", page: "hosts" }],
  ]);
  for (const t of extra) tabs.set(t.id, t);
  useTabStore.setState({
    tabs,
    tabOrder: [HOSTS, ...extra.map((t) => t.id)],
    activeTabId: activeId,
  });
}

describe("MobileSessionBar", () => {
  beforeEach(() => {
    invoke.mockClear();
    resetTabs();
  });

  it("shows the active tab label and keeps the drawer shut initially", () => {
    render(<MobileSessionBar />);
    expect(screen.getByTestId("session-bar-toggle")).toHaveTextContent("Hosts");
    expect(screen.queryByTestId("session-drawer")).not.toBeInTheDocument();
  });

  it("counts open tabs once there is more than one", () => {
    resetTabs([{ type: "terminal", id: "t1", label: "root@box" }]);
    render(<MobileSessionBar />);
    expect(screen.getByTestId("session-bar-toggle")).toHaveTextContent("2");
  });

  it("omits the count badge for a single tab", () => {
    render(<MobileSessionBar />);
    expect(screen.getByTestId("session-bar-toggle")).not.toHaveTextContent("1");
  });

  it("lists every open session when expanded", async () => {
    resetTabs([
      { type: "terminal", id: "t1", label: "root@box" },
      { type: "sftp", id: "s1", label: "files" },
    ]);
    const user = userEvent.setup();
    render(<MobileSessionBar />);

    await user.click(screen.getByTestId("session-bar-toggle"));

    expect(screen.getByTestId("session-drawer")).toBeInTheDocument();
    expect(screen.getByTestId("session-row-t1")).toHaveTextContent("root@box");
    expect(screen.getByTestId("session-row-s1")).toHaveTextContent("files");
  });

  it("switches tab and closes the drawer on selection", async () => {
    resetTabs([{ type: "terminal", id: "t1", label: "root@box" }]);
    const user = userEvent.setup();
    render(<MobileSessionBar />);

    await user.click(screen.getByTestId("session-bar-toggle"));
    await user.click(screen.getByTestId("session-row-t1"));

    expect(useTabStore.getState().activeTabId).toBe("t1");
    expect(screen.queryByTestId("session-drawer")).not.toBeInTheDocument();
  });

  it("closes the drawer when the scrim is tapped", async () => {
    const user = userEvent.setup();
    render(<MobileSessionBar />);

    await user.click(screen.getByTestId("session-bar-toggle"));
    await user.click(screen.getByTestId("session-drawer-scrim"));

    expect(screen.queryByTestId("session-drawer")).not.toBeInTheDocument();
  });

  it("never offers to close the permanent Hosts tab", async () => {
    const user = userEvent.setup();
    render(<MobileSessionBar />);

    expect(
      screen.queryByTestId("session-bar-close-active"),
    ).not.toBeInTheDocument();

    await user.click(screen.getByTestId("session-bar-toggle"));
    expect(
      screen.queryByTestId(`session-row-${HOSTS}-close`),
    ).not.toBeInTheDocument();
  });

  it("disconnects the backend session when a tab is closed", async () => {
    resetTabs([{ type: "sftp", id: "s1", label: "files" }], "s1");
    const user = userEvent.setup();
    render(<MobileSessionBar />);

    await user.click(screen.getByTestId("session-bar-close-active"));

    expect(invoke).toHaveBeenCalledWith("sftp_close", { sftpSessionId: "s1" });
    expect(useTabStore.getState().tabs.has("s1")).toBe(false);
  });

  it("still removes the tab when the backend disconnect fails", async () => {
    invoke.mockRejectedValueOnce(new Error("already gone"));
    resetTabs([{ type: "sftp", id: "s1", label: "files" }], "s1");
    const user = userEvent.setup();
    render(<MobileSessionBar />);

    await user.click(screen.getByTestId("session-bar-close-active"));

    expect(useTabStore.getState().tabs.has("s1")).toBe(false);
  });

  it("renders nothing when there are no tabs at all", () => {
    useTabStore.setState({ tabs: new Map(), tabOrder: [], activeTabId: null });
    const { container } = render(<MobileSessionBar />);
    expect(container).toBeEmptyDOMElement();
  });
});
