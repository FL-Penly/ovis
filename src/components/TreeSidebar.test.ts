// Downstream (FL-Penly/ovis, DOWNSTREAM.md): the tree sidebar's grouping (TreeSidebar.tsx).
import { describe, expect, it } from "bun:test";
import type { HerdrPane, SessionSnapshot, WorkspaceInfo } from "../../shared/protocol.ts";
import { hottest, needsYou, sidebarRowPanes, sidebarWorkspaceIds, splitGroups, tabRows, treeGroups } from "./TreeSidebar.tsx";

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
  it("keeps every workspace in herdr's order, each with its agents and its plain terminals", () => {
    const groups = treeGroups(snapshot(["dev1", "dev2", "dev3"], [
      pane("p1", "dev1", "claude"),
      pane("p2", "dev2"),
      pane("p3", "dev3", "codex"),
      pane("p4", "dev3"),
      pane("p5", "dev1", "codex"),
    ]));
    expect(groups.map(({ workspace, agents, terminals }) => [workspace.workspace_id, agents.map(({ pane }) => pane.pane_id), terminals.map(({ pane_id }) => pane_id)])).toEqual([
      ["dev1", ["p1", "p5"], []],
      ["dev2", [], ["p2"]],
      ["dev3", ["p3"], ["p4"]],
    ]);
  });

  it("has nothing to show before the PC's panes came in", () => {
    expect(treeGroups(null)).toEqual([]);
  });
});

describe("tabRows", () => {
  const at = (id: string, tab: string): HerdrPane => ({ ...pane(id, "dev1", "claude"), tab_id: tab });
  const rect = (x: number, y: number) => ({ x, y, width: 10, height: 10 });
  const roster: SessionSnapshot = {
    ...snapshot(["dev1"], [at("fork", "t1"), at("below", "t1"), at("solo", "t3"), at("first", "t1"), at("shell", "t2")]),
    tabs: [
      { tab_id: "t1", workspace_id: "dev1", label: "1", number: 3, pane_count: 3, focused: false, agent_status: "idle" },
      { tab_id: "t2", workspace_id: "dev1", label: "2", number: 1, pane_count: 1, focused: false, agent_status: "idle" },
      { tab_id: "t3", workspace_id: "dev1", label: "3", number: 2, pane_count: 1, focused: false, agent_status: "idle" },
    ],
    layouts: [{ tab_id: "t1", workspace_id: "dev1", focused_pane_id: "fork", zoomed: false, area: rect(0, 0), splits: [],
      panes: [{ pane_id: "fork", focused: true, rect: rect(10, 0) }, { pane_id: "below", focused: false, rect: rect(10, 5) }, { pane_id: "first", focused: false, rect: rect(0, 0) }] }],
  } as unknown as SessionSnapshot;

  it("lists the tabs in herdr's row order (not by number), a split one as its top-left pane over the rest, left to right then down", () => {
    expect(tabRows(roster, "dev1", (p) => p.pane_id).map(({ tab, head, under }) => [tab.tab_id, head, under])).toEqual([
      ["t1", "first", ["fork", "below"]],
      ["t2", "shell", []],
      ["t3", "solo", []],
    ]);
  });

  it("gives ⌘↑ / ⌘↓ every row of an open workspace in drawn order, and one stop for a terminal-only one", () => {
    const withShell = { ...roster, workspaces: [...roster.workspaces, { ...roster.workspaces[0]!, workspace_id: "dev2", label: "DEV2", active_tab_id: "t9" }],
      tabs: [...roster.tabs, { tab_id: "t9", workspace_id: "dev2", label: "1", number: 1, pane_count: 1, focused: false, agent_status: "idle" }],
      panes: [...roster.panes, { ...pane("sh", "dev2"), tab_id: "t9" }] } as SessionSnapshot;
    expect(sidebarRowPanes(withShell, "local", "first")).toEqual(["first", "fork", "below", "shell", "solo"]);
    expect(sidebarRowPanes(withShell, "local", "sh")).toEqual(["first", "fork", "below", "shell", "solo", "sh"]);
  });

  it("lets the next pane lead a tab whose first one is left out, and drops a tab with none left", () => {
    expect(tabRows(roster, "dev1", (p) => p.pane_id === "first" || p.pane_id === "shell" ? null : p.pane_id).map(({ tab, head, under }) => [tab.tab_id, head, under])).toEqual([
      ["t1", "fork", ["below"]],
      ["t3", "solo", []],
    ]);
  });
});

describe("splitGroups", () => {
  const roster = snapshot(["dev1", "dev2", "dev3", "dev4"], [pane("p1", "dev1"), pane("p2", "dev2", "claude"), pane("p3", "dev3"), pane("p4", "dev4", "codex")]);

  it("keeps the workspaces with an agent in herdr's order and puts the terminal-only ones apart, in theirs", () => {
    const { withAgents, terminalsOnly } = splitGroups(treeGroups(roster));
    expect(withAgents.map(({ workspace }) => workspace.workspace_id)).toEqual(["dev2", "dev4"]);
    expect(terminalsOnly.map(({ workspace }) => workspace.workspace_id)).toEqual(["dev1", "dev3"]);
  });

  it("steps the keyboard over the agents' workspaces, then the folded group's only where the open pane is", () => {
    expect(sidebarWorkspaceIds(roster, "p2")).toEqual(["dev2", "dev4"]);
    expect(sidebarWorkspaceIds(roster, "p3")).toEqual(["dev2", "dev4", "dev3"]);
  });
});

describe("needsYou", () => {
  it("asks for an open question or an unseen answer, never for a running or idle agent", () => {
    expect(["blocked", "done"].every((status) => needsYou(status))).toBe(true);
    expect([undefined, "idle", "working", "waiting", "mystery"].some((status) => needsYou(status))).toBe(false);
  });
});

describe("hottest", () => {
  it("stands a folded group for its working agent first, then a question, then a finish, else nothing", () => {
    expect(hottest(["done", "blocked", "working"])).toBe("working");
    expect(hottest(["idle", "done", "blocked"])).toBe("blocked");
    expect(hottest(["idle", "done"])).toBe("done");
    expect(hottest(["idle", undefined])).toBeNull();
  });
});
