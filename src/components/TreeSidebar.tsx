/**
 * Downstream (FL-Penly/ovis, DOWNSTREAM.md): the sidebar as one tree. Each workspace that runs an
 * agent heads its agents (folded, it shows the state that most asks for a look); workspaces with
 * only terminals fold into one Terminals row; Needs you narrows the tree to the agents that wait on
 * an answer or finished unseen. MachineSidebar draws it in place of each PC's workspace list and
 * the separate Agents list while the layout is "tree" (the sidebar's footer button switches back).
 * Workspace management (rename, close, worktrees, reorder, pins) stays in the classic layout.
 */
import { useMemo, useSyncExternalStore } from "react";
import { BellRing, ChevronDown, ChevronRight, ListTree, PanelsTopLeft, Terminal } from "lucide-react";
import type { Machine } from "../../shared/machines.ts";
import type { AgentStatus, PaneInfo, SessionSnapshot, WorkspaceInfo } from "../../shared/protocol.ts";
import { useT } from "../lib/i18n.ts";
import { knownStatus, rollupStatus, type KnownStatus } from "../lib/status.ts";
import { rosterPanes } from "../lib/dagPane.ts";
import { lastViewedPane } from "../lib/lastViewedPane.ts";
import { useMachineId } from "../lib/machineContext.tsx";
import { useSidebarActivity } from "../lib/sidebarActivity.tsx";
import { agentTabName, paneMark, sidebarAgents, type SidebarAgent } from "../lib/sidebarAgents.ts";
import { PANE_DRAG_TYPE, paneDragData } from "../lib/split.ts";
import { useWorktreeBranches } from "../lib/useWorktreeBranches.ts";
import { AgentMark } from "./AgentMark.tsx";
import { displayPaneTitle, StatusBadge } from "./Sidebar.tsx";
import "./TreeSidebar.css";

type Layout = "tree" | "classic";
interface TreeState { layout: Layout; needsOnly: boolean }

const LAYOUT_KEY = "ovis-downstream:sidebar-layout";
const FOLD_KEY = "ovis-downstream:sidebar-folded";
const NEEDS: ReadonlySet<KnownStatus> = new Set(["blocked", "done"]);
/** branches every repository has: a row that says one says nothing */
const PLAIN_BRANCHES = new Set(["main", "master"]);

const stored = (key: string): string | null => { try { return localStorage.getItem(key); } catch { return null; } };
const store = (key: string, value: string): void => { try { localStorage.setItem(key, value); } catch { /* storage denied: kept for this page */ } };

let state: TreeState = { layout: stored(LAYOUT_KEY) === "classic" ? "classic" : "tree", needsOnly: false };
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const current = (): TreeState => state;
function update(next: Partial<TreeState>): void {
  state = { ...state, ...next };
  store(LAYOUT_KEY, state.layout);
  for (const listener of listeners) listener();
}

/** the folds this browser keeps, by PC and workspace; "<pc>\0terminals" is the Terminals row, which starts folded, open */
let folds: ReadonlySet<string> = new Set(JSON.parse(stored(FOLD_KEY) ?? "[]") as string[]);
const foldListeners = new Set<() => void>();
const subscribeFolds = (listener: () => void) => { foldListeners.add(listener); return () => { foldListeners.delete(listener); }; };
const currentFolds = () => folds;
function setFolded(key: string, folded: boolean): void {
  const next = new Set(folds);
  if (folded) next.add(key); else next.delete(key);
  folds = next;
  store(FOLD_KEY, JSON.stringify([...next]));
  for (const listener of foldListeners) listener();
}

export const useTreeSidebar = (): boolean => useSyncExternalStore(subscribe, current, current).layout === "tree";

/** The footer's switch between this tree and the classic workspace and Agents lists. */
export function SidebarLayoutToggle() {
  const t = useT();
  const tree = useTreeSidebar();
  const label = tree ? t("Switch to the classic sidebar") : t("Switch to the tree sidebar");
  return <button type="button" className="btn btn-ghost sidebar-footer-action tree-layout-toggle" aria-label={label} title={label}
    onClick={() => update({ layout: tree ? "classic" : "tree", needsOnly: false })}>
    {tree ? <PanelsTopLeft aria-hidden="true" /> : <ListTree aria-hidden="true" />}
  </button>;
}

/** Needs you, over all PCs: how many agents wait on the user, and the switch that shows only them. */
export function NeedsYouBar({ machines }: { machines: Machine[] }) {
  const t = useT();
  const { needsOnly } = useSyncExternalStore(subscribe, current, current);
  const activity = useSidebarActivity();
  const count = machines.reduce((sum, machine) => machine.state !== "connected" ? sum
    : sum + sidebarAgents(machine.snapshot).filter(({ pane }) => needsYou(activity.status(machine.id, pane))).length, 0);
  return <button type="button" className={`tree-needs${needsOnly ? " is-active" : ""}${count > 0 ? " has-needs" : ""}`} aria-pressed={needsOnly}
    title={needsOnly ? t("Show every agent") : t("Show only the agents that wait on you or finished")}
    onClick={() => update({ needsOnly: !needsOnly })}>
    <BellRing aria-hidden="true" />
    <span>{t("Waiting on you")}</span>
    <span className="tree-needs-count">{count}</span>
  </button>;
}

interface WorkspaceAgents { workspace: WorkspaceInfo; agents: SidebarAgent[] }

/** A PC's workspaces in herdr's order: those that run an agent, with their agents, and those with terminals only. */
export function treeGroups(snapshot: SessionSnapshot | null): { groups: WorkspaceAgents[]; terminals: WorkspaceInfo[] } {
  const byWorkspace = new Map<string, SidebarAgent[]>();
  for (const entry of sidebarAgents(snapshot)) {
    const list = byWorkspace.get(entry.workspace.workspace_id) ?? [];
    list.push(entry);
    byWorkspace.set(entry.workspace.workspace_id, list);
  }
  const groups: WorkspaceAgents[] = [];
  const terminals: WorkspaceInfo[] = [];
  for (const workspace of snapshot?.workspaces ?? []) {
    const agents = byWorkspace.get(workspace.workspace_id);
    if (agents) groups.push({ workspace, agents }); else terminals.push(workspace);
  }
  return { groups, terminals };
}

/** Whether a state asks for the user: an open question, or an answer not seen yet. */
export const needsYou = (status: AgentStatus | undefined): boolean => NEEDS.has(knownStatus(status));

/** One PC's workspaces as a tree; MachineGroup draws it in place of its workspace list. */
export function TreeWorkspaces({ machine, snapshot, online, selectedPaneId, onSelect }: { machine: Machine; snapshot: SessionSnapshot | null; online: boolean; selectedPaneId: string | null; onSelect(paneId: string): void }) {
  const t = useT();
  const machineId = useMachineId();
  const activity = useSidebarActivity();
  const { needsOnly } = useSyncExternalStore(subscribe, current, current);
  const folded = useSyncExternalStore(subscribeFolds, currentFolds, currentFolds);
  const { branches } = useWorktreeBranches(snapshot, online, true);
  const status = (pane: PaneInfo): AgentStatus | undefined => online ? activity.status(machine.id, pane) : undefined;

  const { groups, terminals } = useMemo(() => treeGroups(snapshot), [snapshot]);

  /** the pane a Terminals row opens: as a classic workspace row picks it */
  const openPane = (workspace: WorkspaceInfo): PaneInfo | undefined => {
    const panes = rosterPanes((snapshot?.panes ?? []).filter((pane) => pane.workspace_id === workspace.workspace_id), selectedPaneId);
    const pick = (id: string | null | undefined) => (id ? panes.find((pane) => pane.pane_id === id) : undefined);
    return pick(selectedPaneId)
      ?? pick(lastViewedPane("workspace", machineId, workspace.workspace_id))
      ?? pick(snapshot?.layouts?.find((layout) => layout.tab_id === workspace.active_tab_id)?.focused_pane_id)
      ?? panes.find((pane) => pane.focused)
      ?? panes[0];
  };

  const agentRow = (entry: SidebarAgent, place: string | null) => {
    const { pane, agent, tab, workspace } = entry;
    const selected = pane.pane_id === selectedPaneId;
    const title = pane.label?.trim() || agent?.title?.trim() || pane.title?.trim() || displayPaneTitle(pane);
    const tabs = snapshot?.tabs.filter((candidate) => candidate.workspace_id === workspace.workspace_id) ?? [];
    const name = agent?.name?.trim() || null;
    const context = [place, name, agentTabName(tab, tabs, t)].filter(Boolean).join(" · ");
    const mark = paneMark(entry);
    return <li key={pane.pane_id} className={`agent-item tree-agent${selected ? " is-selected" : ""}`}>
      <button type="button" className="agent-row" disabled={!online} aria-current={selected ? "true" : undefined}
        title={[title, context, entry.agentLabel, pane.cwd].filter(Boolean).join("\n")} onClick={() => onSelect(pane.pane_id)}
        draggable={online}
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData(PANE_DRAG_TYPE, paneDragData({ machineId: machine.id, paneId: pane.pane_id }));
        }}>
        <span className="sidebar-mark" aria-hidden="true">{mark !== null ? <AgentMark agent={mark} size={18} /> : <Terminal />}</span>
        <span className="agent-copy">
          <span className="tree-line">
            <span className="agent-title">{title}</span>
            {context && <span className="agent-context">{context}</span>}
          </span>
        </span>
        <span className="agent-row-state"><StatusBadge status={status(pane)} compact /></span>
      </button>
    </li>;
  };

  if (!snapshot) return <div className="machine-workspaces tree-workspaces"><p className="tree-state" role="status">{t("Loading this PC's workspaces…")}</p></div>;

  if (needsOnly) {
    const needy = groups.flatMap(({ workspace, agents }) => agents.filter(({ pane }) => needsYou(status(pane))).map((entry) => ({ entry, workspace })));
    return <div className="machine-workspaces tree-workspaces">
      {needy.length === 0 ? <p className="tree-empty">{t("Nothing waits on you here")}</p>
        : <ul className="agent-list tree-agents is-flat">{needy.map(({ entry, workspace }) => agentRow(entry, workspace.label))}</ul>}
    </div>;
  }

  const terminalsKey = `${machine.id}\u0000terminals`;
  // a selected terminal keeps its row open
  const terminalsShown = folded.has(terminalsKey)
    || terminals.some((workspace) => (snapshot.panes ?? []).some((pane) => pane.workspace_id === workspace.workspace_id && pane.pane_id === selectedPaneId));
  return <div className="machine-workspaces tree-workspaces">
    {groups.map(({ workspace, agents }) => {
      const key = `${machine.id}\u0000${workspace.workspace_id}`;
      const holdsSelection = agents.some(({ pane }) => pane.pane_id === selectedPaneId);
      const open = !folded.has(key) || holdsSelection;
      const branch = branches.get(workspace.workspace_id)?.branch ?? null;
      const branchNote = branch && !PLAIN_BRANCHES.has(branch) && branch !== workspace.label ? branch : null;
      const label = open ? t("Fold {name}", { name: workspace.label }) : t("Unfold {name}", { name: workspace.label });
      return <section key={workspace.workspace_id} className={`tree-group${holdsSelection ? " is-current" : ""}`} aria-label={workspace.label}>
        <button type="button" className="tree-head" aria-expanded={open} title={label} onClick={() => setFolded(key, open)}>
          <span className="sidebar-mark" aria-hidden="true">{open ? <ChevronDown /> : <ChevronRight />}</span>
          <span className="tree-head-name">{workspace.label}</span>
          {branchNote && <span className="tree-head-branch">{branchNote}</span>}
          {!open && <span className="tree-head-count">{agents.length}</span>}
          {!open && <span className="tree-head-state"><StatusBadge status={rollupStatus(agents.map(({ pane }) => status(pane))) as AgentStatus} compact /></span>}
        </button>
        {open && <ul className="agent-list tree-agents">{agents.map((entry) => agentRow(entry, null))}</ul>}
      </section>;
    })}
    {terminals.length > 0 && <section className="tree-group tree-terminals" aria-label={t("Terminal-only workspaces")}>
      <button type="button" className="tree-head" aria-expanded={terminalsShown} onClick={() => setFolded(terminalsKey, !terminalsShown)}>
        <span className="sidebar-mark" aria-hidden="true">{terminalsShown ? <ChevronDown /> : <ChevronRight />}</span>
        <span className="tree-head-name">{t("Terminal-only workspaces")}</span>
        <span className="tree-head-count">{terminals.length}</span>
      </button>
      {terminalsShown && <ul className="agent-list tree-agents">{terminals.map((workspace) => {
        const pane = openPane(workspace);
        const selected = pane !== undefined && pane.pane_id === selectedPaneId;
        return <li key={workspace.workspace_id} className={`agent-item tree-agent${selected ? " is-selected" : ""}`}>
          <button type="button" className="agent-row" disabled={!online || pane === undefined} aria-current={selected ? "true" : undefined}
            title={[workspace.label, pane?.cwd].filter(Boolean).join("\n")} onClick={() => pane && onSelect(pane.pane_id)}>
            <span className="sidebar-mark" aria-hidden="true"><Terminal /></span>
            <span className="agent-copy"><span className="tree-line"><span className="agent-title">{workspace.label}</span></span></span>
          </button>
        </li>;
      })}</ul>}
    </section>}
  </div>;
}
