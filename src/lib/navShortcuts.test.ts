// Downstream (FL-Penly/ovis, DOWNSTREAM.md): the workspace and tab keys (navShortcuts.ts).
import { describe, expect, it } from "bun:test";
import type { HerdrPane, SessionSnapshot } from "../../shared/protocol.ts";
import { navMove, navTarget } from "./navShortcuts.ts";

const key = (key: string, mods: Partial<Record<"metaKey" | "ctrlKey" | "altKey" | "shiftKey", boolean>> = {}, code = "") =>
  ({ key, code, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, isComposing: false, ...mods });

describe("navMove", () => {
  it("reads ⌘ with the arrows and T on a Mac", () => {
    expect(navMove(key("ArrowUp", { metaKey: true }), true)).toBe("workspace-previous");
    expect(navMove(key("ArrowDown", { metaKey: true }), true)).toBe("workspace-next");
    expect(navMove(key("ArrowLeft", { metaKey: true }), true)).toBe("tab-previous");
    expect(navMove(key("ArrowRight", { metaKey: true }), true)).toBe("tab-next");
    expect(navMove(key("t", { metaKey: true }, "KeyT"), true)).toBe("terminal-tab");
  });

  it("leaves upstream's ⌘⇧ arrows, plain arrows and Ctrl+arrows alone", () => {
    expect(navMove(key("ArrowUp", { metaKey: true, shiftKey: true }), true)).toBeNull();
    expect(navMove(key("ArrowUp"), true)).toBeNull();
    expect(navMove(key("ArrowLeft", { ctrlKey: true }), false)).toBeNull();
  });

  it("takes Ctrl+Alt off a Mac, where Ctrl+arrows move by word", () => {
    expect(navMove(key("ArrowDown", { ctrlKey: true, altKey: true }), false)).toBe("workspace-next");
    expect(navMove(key("ArrowDown", { metaKey: true }), false)).toBeNull();
  });
});

const pane = (id: string, workspace: string, tab: string, extra: Partial<HerdrPane> = {}): HerdrPane =>
  ({ pane_id: id, workspace_id: workspace, tab_id: tab, terminal_id: `${id}:term`, revision: 1, focused: false, agent_status: "idle", ...extra });

const snapshot: SessionSnapshot = {
  protocol: 22, version: "test", agents: [],
  workspaces: ["w1", "w2", "w3"].map((id, index) => ({ workspace_id: id, active_tab_id: `${id}:t1`, label: id, number: index + 1, tab_count: 2, pane_count: 2, focused: false, agent_status: "idle" })),
  tabs: ["w1", "w2", "w3"].flatMap((workspace) => [1, 2].map((number) => ({ tab_id: `${workspace}:t${number}`, workspace_id: workspace, label: String(number), number, pane_count: 1, focused: false, agent_status: "idle" }))),
  layouts: [{ tab_id: "w2:t1", focused_pane_id: "w2b" } as never],
  panes: [
    pane("w1a", "w1", "w1:t1"), pane("w1t2", "w1", "w1:t2"),
    pane("w2a", "w2", "w2:t1"), pane("w2b", "w2", "w2:t1"), pane("w2t2", "w2", "w2:t2"),
    pane("w3a", "w3", "w3:t1"), pane("w3t2", "w3", "w3:t2"),
  ],
};

describe("navTarget", () => {
  const all = ["w1", "w2", "w3"];

  it("steps through the sidebar's workspaces, landing on the pane in front, and wraps around", () => {
    expect(navTarget(snapshot, "local", "w1a", all, "workspace-next")).toBe("w2b");
    expect(navTarget(snapshot, "local", "w3a", all, "workspace-next")).toBe("w1a");
    expect(navTarget(snapshot, "local", "w1a", all, "workspace-previous")).toBe("w3a");
  });

  it("skips the workspaces the sidebar hides, yet steps on from a hidden one that is open", () => {
    expect(navTarget(snapshot, "local", "w1a", ["w1", "w3"], "workspace-next")).toBe("w3a");
    expect(navTarget(snapshot, "local", "w2a", ["w1", "w3"], "workspace-next")).toBe("w3a");
    expect(navTarget(snapshot, "local", "w2a", ["w1", "w3"], "workspace-previous")).toBe("w1a");
  });

  it("steps through the open workspace's tabs and wraps around", () => {
    expect(navTarget(snapshot, "local", "w2a", all, "tab-next")).toBe("w2t2");
    expect(navTarget(snapshot, "local", "w2t2", all, "tab-next")).toBe("w2b");
    expect(navTarget(snapshot, "local", "w2a", all, "tab-previous")).toBe("w2t2");
  });

  it("goes nowhere with one workspace or one tab, or nothing open", () => {
    expect(navTarget(snapshot, "local", "w1a", ["w1"], "workspace-next")).toBeNull();
    const single = { ...snapshot, tabs: snapshot.tabs.filter((tab) => tab.tab_id !== "w1:t2"), panes: snapshot.panes.filter((p) => p.pane_id !== "w1t2") };
    expect(navTarget(single, "local", "w1a", all, "tab-next")).toBeNull();
    expect(navTarget(snapshot, "local", null, all, "tab-next")).toBeNull();
  });
});
