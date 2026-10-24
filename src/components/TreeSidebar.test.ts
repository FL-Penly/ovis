// Downstream (FL-Penly/ovis, DOWNSTREAM.md): the tree sidebar's grouping (TreeSidebar.tsx).
import { describe, expect, it } from "bun:test";
import type { HerdrPane, SessionSnapshot, WorkspaceInfo } from "../../shared/protocol.ts";
import { needsYou, treeGroups } from "./TreeSidebar.tsx";

const workspace = (id: string): WorkspaceInfo => ({ workspace_id: id, active_tab_id: `${id}:t1`, label: id.toUpperCase(), number: 1, tab_count: 1, pane_count: 1, focused: false, agent_status: "idle" });
const pane = (id: string, workspaceId: string, agent?: string): HerdrPane => ({ pane_id: id, workspace_id: workspaceId, tab_id: `${workspaceId}:t1`, terminal_id: `${id}:term`, revision: 1, focused: false, agent_status: "idle", ...(agent ? { agent } : {}) });

function snapshot(workspaces: string[], panes: HerdrPane[]): SessionSnapshot {
  return {
    protocol: 22, version: "test", layouts: [], agents: [], panes,
    workspaces: workspaces.map(workspace),
    tabs: workspaces.map((id) => ({ tab_id: `${id}:t1`, workspace_id: id, label: "1", number: 1, pane_count: 1, focused: false, agent_status: "idle" })),
  };
}

describe("treeGroups", () => {
  it("heads each workspace's agents with it, in herdr's order, and sets terminal-only workspaces apart", () => {
    const { groups, terminals } = treeGroups(snapshot(["dev1", "dev2", "dev3"], [
      pane("p1", "dev1", "claude"),
      pane("p2", "dev2"),
      pane("p3", "dev3", "codex"),
      pane("p4", "dev3"),
      pane("p5", "dev1", "codex"),
    ]));
    expect(groups.map(({ workspace, agents }) => [workspace.workspace_id, agents.map(({ pane }) => pane.pane_id)])).toEqual([
      ["dev1", ["p1", "p5"]],
      ["dev3", ["p3"]],
    ]);
    expect(terminals.map((workspace) => workspace.workspace_id)).toEqual(["dev2"]);
  });

  it("has nothing to show before the PC's panes came in", () => {
    expect(treeGroups(null)).toEqual({ groups: [], terminals: [] });
  });
});

describe("needsYou", () => {
  it("asks for an open question or an unseen answer, never for a running or idle agent", () => {
    expect(["blocked", "done"].every((status) => needsYou(status))).toBe(true);
    expect([undefined, "idle", "working", "waiting", "mystery"].some((status) => needsYou(status))).toBe(false);
  });
});
