/**
 * Downstream (FL-Penly/ovis, DOWNSTREAM.md): the sidebar as herdr-web drew it. A New session and a
 * Needs you entry on top; then every workspace as a group head (its fold, its branch, a + for a new
 * tab, and while folded the dot of the agent that most asks for a look) over its tabs in herdr's
 * order, agents and terminals alike: a tab is its top-left pane's row, and the other panes of a split
 * tab hang under it (tabRows). A left-press drag moves a workspace by its head, or a tab by its row
 * within its workspace; ⌘↑ / ⌘↓ step down the rows as drawn (sidebarRowPanes). The tab strip is not drawn while this sidebar is (TreeSidebar.css):
 * the rows are the tabs. A workspace with no agent waits folded in a Terminals only group under
 * the rest, opened by its head or while it holds the open pane. Needs you lists only the agents with an open question or an answer not
 * seen yet. MachineSidebar draws it in place of each PC's workspace list and the Agents list while
 * the layout is "tree"; the footer's layout button switches back to upstream's.
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type DragEvent, type ReactNode } from "react";
import { ArrowDown, ArrowUp, BellRing, ChevronRight, ChevronsDownUp, ChevronsUpDown, Columns2, Copy, Ellipsis, History, Rows2, Send, Users, ListTree, PanelsTopLeft, Pencil, Plus, SquarePen, Terminal, X } from "lucide-react";
import type { Machine } from "../../shared/machines.ts";
import type { AgentStatus, HerdrTab, PaneInfo, SessionSnapshot, WorkspaceInfo } from "../../shared/protocol.ts";
import type { AppActions } from "../lib/actions.ts";
import { useT } from "../lib/i18n.ts";
import { knownStatus, type KnownStatus } from "../lib/status.ts";
import { rosterPanes } from "../lib/dagPane.ts";
import { copyText } from "../lib/clipboard.ts";
import { useMachineApi } from "../lib/machineContext.tsx";
import { useSidebarActivity } from "../lib/sidebarActivity.tsx";
import { paneMark, sidebarAgents, type SidebarAgent } from "../lib/sidebarAgents.ts";
import { PANE_DRAG_TYPE, paneDragData } from "../lib/split.ts";
import { useWorktreeBranches } from "../lib/useWorktreeBranches.ts";
import { drivenByTests } from "../lib/upstreamTests.ts";
import { frontPane } from "../lib/navShortcuts.ts";
import { lastViewedPane } from "../lib/lastViewedPane.ts";
import { tabLabel } from "../lib/tabName.ts";
import { adjacentTabBoundary } from "../lib/tabOrder.ts";
import { AgentMark } from "./AgentMark.tsx";
import { openQuickTab } from "./QuickTabPicker.tsx";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import { RowMenu, type RowMenuItem } from "./RowMenu.tsx";
import { BackgroundBadge, displayPaneTitle } from "./Sidebar.tsx";
import { windowLabel } from "../../shared/long-run.ts";
import { useLongRunPanes } from "../lib/longRun.ts";
import "./TreeSidebar.css";

type Layout = "tree" | "classic";
interface TreeState { layout: Layout; needsOnly: boolean; terminalsOnlyOpen: boolean; folded: ReadonlySet<string> }

const LAYOUT_KEY = "ovis-downstream:sidebar-layout";
const TERMINALS_ONLY_KEY = "ovis-downstream:sidebar-terminals-only-open";
const FOLD_KEY = "ovis-downstream:sidebar-folded";

const stored = (key: string): string | null => { try { return localStorage.getItem(key); } catch { return null; } };
const store = (key: string, value: string): void => { try { localStorage.setItem(key, value); } catch { /* storage denied: kept for this page */ } };
function storedFolds(): Set<string> {
  try { return new Set(JSON.parse(stored(FOLD_KEY) ?? "[]") as string[]); } catch { return new Set(); }
}

let state: TreeState = {
  // the tree unless turned off; a browser driven by automation (upstream's browser tests, written for the
  // classic list) starts on the classic one, which a person's browser never does
  layout: stored(LAYOUT_KEY) === "classic" || (stored(LAYOUT_KEY) === null && drivenByTests) ? "classic" : "tree",
  needsOnly: false,
  terminalsOnlyOpen: stored(TERMINALS_ONLY_KEY) === "1",
  folded: storedFolds(),
};
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const current = (): TreeState => state;
// the tab strip steps aside while the tree is drawn: its rows are the tabs (TreeSidebar.css)
function markLayout(): void { if (typeof document !== "undefined") document.documentElement.dataset["sidebarLayout"] = state.layout; }
markLayout();
function update(next: Partial<TreeState>): void {
  state = { ...state, ...next };
  markLayout();
  store(LAYOUT_KEY, state.layout);
  store(TERMINALS_ONLY_KEY, state.terminalsOnlyOpen ? "1" : "0");
  store(FOLD_KEY, JSON.stringify([...state.folded]));
  for (const listener of listeners) listener();
}
const useTreeState = (): TreeState => useSyncExternalStore(subscribe, current, current);
const foldKey = (machineId: string, workspaceId: string): string => `${machineId}\u0000${workspaceId}`;

export const useTreeSidebar = (): boolean => useTreeState().layout === "tree";

/**
 * The folds once `paneId` is opened: its workspace unfolds, so a pane picked in a folded one (a row,
 * ⌘↑ / ⌘↓, Needs you) shows where it is. Null when nothing changes. Only the pick unfolds: the open
 * pane's workspace folds again like any other.
 */
export function foldsOnOpen(folded: ReadonlySet<string>, machineId: string, snapshot: SessionSnapshot | null, paneId: string | null): Set<string> | null {
  const workspaceId = paneId === null ? undefined : snapshot?.panes.find((pane) => pane.pane_id === paneId)?.workspace_id;
  if (workspaceId === undefined || !folded.has(foldKey(machineId, workspaceId))) return null;
  const next = new Set(folded);
  next.delete(foldKey(machineId, workspaceId));
  return next;
}

/** Whether a state asks for the user: an open question, or an answer not seen yet. */
export const needsYou = (status: AgentStatus | undefined): boolean => {
  const known = knownStatus(status);
  return known === "blocked" || known === "done";
};

/** The state that stands for a folded group, as herdr-web picked it: working, then a question, then a finish. */
export function hottest(statuses: ReadonlyArray<AgentStatus | undefined>): KnownStatus | null {
  const known = statuses.map((status) => knownStatus(status));
  return (["working", "waiting", "blocked", "done"] as const).find((status) => known.includes(status)) ?? null;
}

interface WorkspaceRows { workspace: WorkspaceInfo; agents: SidebarAgent[]; terminals: PaneInfo[] }

/** A PC's workspaces in herdr's order, each with its agents and its plain terminals. */
export function treeGroups(snapshot: SessionSnapshot | null): WorkspaceRows[] {
  if (!snapshot) return [];
  const agents = sidebarAgents(snapshot);
  const agentPanes = new Set(agents.map(({ pane }) => pane.pane_id));
  return snapshot.workspaces.map((workspace) => ({
    workspace,
    agents: agents.filter((entry) => entry.workspace.workspace_id === workspace.workspace_id),
    terminals: rosterPanes(snapshot.panes.filter((pane) => pane.workspace_id === workspace.workspace_id && !agentPanes.has(pane.pane_id))),
  }));
}

/** A tab in the sidebar: its top-left pane's row, and the other panes of a split under it. */
export interface TabRows<T> { tab: HerdrTab; head: T; under: T[] }

/**
 * A workspace's rows in herdr's tab order. A tab's panes go left to right, then top to bottom, as its
 * layout places them; `shown` maps a pane to its row, or null for one the list leaves out (a DAG
 * viewer beside its pane), and a tab with no row left is dropped.
 */
export function tabRows<T>(snapshot: SessionSnapshot, workspaceId: string, shown: (pane: PaneInfo) => T | null): TabRows<T>[] {
  // herdr lists a workspace's tabs in their row's order; a tab's number is not its place
  const tabs = snapshot.tabs.filter((tab) => tab.workspace_id === workspaceId);
  return tabs.flatMap((tab) => {
    const rects = new Map((snapshot.layouts?.find((layout) => layout.tab_id === tab.tab_id)?.panes ?? []).map((entry) => [entry.pane_id, entry.rect]));
    const place = (pane: PaneInfo): [number, number] => { const rect = rects.get(pane.pane_id); return rect ? [rect.y, rect.x] : [Infinity, Infinity]; };
    const panes = snapshot.panes.filter((pane) => pane.tab_id === tab.tab_id)
      .map((pane, at) => ({ pane, at })).sort((one, other) => {
        const [y1, x1] = place(one.pane); const [y2, x2] = place(other.pane);
        return y1 - y2 || x1 - x2 || one.at - other.at;
      });
    const rows = panes.flatMap(({ pane }) => { const row = shown(pane); return row === null ? [] : [row]; });
    return rows.length === 0 ? [] : [{ tab, head: rows[0]!, under: rows.slice(1) }];
  });
}

/** The workspaces with an agent first, then the Terminals only group's, which it holds out of sight while folded. */
export function splitGroups(groups: readonly WorkspaceRows[]): { withAgents: WorkspaceRows[]; terminalsOnly: WorkspaceRows[] } {
  return { withAgents: groups.filter(({ agents }) => agents.length > 0), terminalsOnly: groups.filter(({ agents }) => agents.length === 0) };
}

/** The workspaces the sidebar lists, in its order, for the keyboard's workspace steps (lib/navShortcuts.ts). */
export function sidebarWorkspaceIds(snapshot: SessionSnapshot, selectedPaneId: string | null): string[] {
  if (state.layout !== "tree") return snapshot.workspaces.map((workspace) => workspace.workspace_id);
  const { withAgents, terminalsOnly } = splitGroups(treeGroups(snapshot));
  const shown = state.terminalsOnlyOpen ? terminalsOnly : terminalsOnly.filter(({ terminals }) => terminals.some((pane) => pane.pane_id === selectedPaneId));
  return [...withAgents, ...shown].map(({ workspace }) => workspace.workspace_id);
}

/**
 * The panes ⌘↑ / ⌘↓ step through, in the order the rows are drawn: every row of an open workspace (a tab's
 * head, then its split's panes), one stop for a folded one (the pane it opens on, which unfolds it), and
 * the Terminals only group's lines while it shows them. Null for the classic sidebar.
 */
export function sidebarRowPanes(snapshot: SessionSnapshot, machineId: string, selectedPaneId: string | null): string[] | null {
  if (state.layout !== "tree") return null;
  const { withAgents, terminalsOnly } = splitGroups(treeGroups(snapshot));
  const holds = (ids: ReadonlySet<string>): boolean => selectedPaneId !== null && ids.has(selectedPaneId);
  const opensOn = (workspace: WorkspaceInfo, panes: readonly PaneInfo[]): string[] => {
    const focused = snapshot.layouts?.find((layout) => layout.tab_id === workspace.active_tab_id)?.focused_pane_id;
    const pane = frontPane(panes, lastViewedPane("workspace", machineId, workspace.workspace_id), focused);
    return pane ? [pane.pane_id] : [];
  };
  const rows = (workspace: WorkspaceInfo, shown: ReadonlySet<string>): string[] =>
    tabRows(snapshot, workspace.workspace_id, (pane) => shown.has(pane.pane_id) ? pane.pane_id : null).flatMap(({ head, under }) => [head, ...under]);
  const stops = withAgents.flatMap(({ workspace, agents, terminals }) => {
    const shown = new Set([...agents.map(({ pane }) => pane.pane_id), ...terminals.map((pane) => pane.pane_id)]);
    if (!state.folded.has(foldKey(machineId, workspace.workspace_id))) return rows(workspace, shown);
    // folded: one stop, the open pane itself when it is in there
    return holds(shown) ? [selectedPaneId!] : opensOn(workspace, [...agents.map(({ pane }) => pane), ...terminals]);
  });
  for (const { workspace, terminals } of terminalsOnly) {
    const shown = new Set(terminals.map((pane) => pane.pane_id));
    if (holds(shown)) stops.push(...(terminals.length > 1 ? rows(workspace, shown) : opensOn(workspace, terminals)));
    else if (state.terminalsOnlyOpen) stops.push(...opensOn(workspace, terminals));
  }
  return stops;
}

/** herdr-web's state dot: a spinner while it works, a ringed blue dot for a question, green for an answer not seen yet. */
function StateDot({ status }: { status: KnownStatus | null }) {
  const t = useT();
  const kind = status === "working" || status === "waiting" ? "running" : status === "blocked" ? "needs" : status === "done" ? "done" : "idle";
  const label = kind === "running" ? t("Working") : kind === "needs" ? t("Waits for your answer") : kind === "done" ? t("Finished, not seen yet") : t("Idle");
  return <span className={`tree-dot is-${kind}`} role="img" aria-label={label} title={label} />;
}

/** The footer's switch between this sidebar and upstream's workspace and Agents lists. */
export function SidebarLayoutToggle() {
  const t = useT();
  const tree = useTreeSidebar();
  const label = tree ? t("Switch to the classic sidebar") : t("Switch to the tree sidebar");
  return <button type="button" className="btn btn-ghost tree-layout-toggle" aria-label={label} title={label}
    onClick={() => update({ layout: tree ? "classic" : "tree", needsOnly: false })}>
    {tree ? <PanelsTopLeft aria-hidden="true" /> : <ListTree aria-hidden="true" />}
  </button>;
}

/** The top of the list: New session, Needs you with its count, and the list's head with its fold-all switch. */
export function TreeNav({ machines, onNew }: { machines: Machine[]; onNew(): void }) {
  const t = useT();
  const { needsOnly, folded } = useTreeState();
  const activity = useSidebarActivity();
  const online = machines.filter((machine) => machine.state === "connected");
  const count = online.reduce((sum, machine) => sum + sidebarAgents(machine.snapshot).filter(({ pane }) => needsYou(activity.status(machine.id, pane))).length, 0);
  const keys = online.flatMap((machine) => splitGroups(treeGroups(machine.snapshot)).withAgents
    .map(({ workspace }) => foldKey(machine.id, workspace.workspace_id)));
  const anyOpen = keys.some((key) => !folded.has(key));
  const foldLabel = anyOpen ? t("Fold every workspace") : t("Unfold every workspace");
  return <div className="tree-top">
    <nav className="tree-nav">
      <button type="button" className="tree-nav-item" onClick={onNew}><SquarePen aria-hidden="true" /><span>{t("Start a session")}</span></button>
      <button type="button" className="tree-nav-item" aria-pressed={needsOnly} onClick={() => update({ needsOnly: !needsOnly })}>
        <BellRing aria-hidden="true" /><span>{t("Waiting on you")}</span>
        {count > 0 && <span className="tree-nav-badge">{count}</span>}
      </button>
    </nav>
    <div className="tree-label">
      <h2>{needsOnly ? t("Waiting on you") : t("Sessions")}</h2>
      {!needsOnly && <div className="tree-tools">
        <button type="button" className="tree-tool" aria-label={foldLabel} title={foldLabel} disabled={keys.length === 0}
          onClick={() => {
            const next = new Set(folded);
            for (const key of keys) if (anyOpen) next.add(key); else next.delete(key);
            update({ folded: next });
          }}>{anyOpen ? <ChevronsDownUp aria-hidden="true" /> : <ChevronsUpDown aria-hidden="true" />}</button>
      </div>}
    </div>
  </div>;
}

type Menu = { kind: "workspace"; workspace: WorkspaceInfo; anchor: HTMLElement; point?: { x: number; y: number } }
  | { kind: "pane"; pane: PaneInfo; title: string; agent: SidebarAgent | null; head: boolean; anchor: HTMLElement; point?: { x: number; y: number } };
type MenuTarget = { kind: "workspace"; workspace: WorkspaceInfo } | { kind: "pane"; pane: PaneInfo; title: string; agent: SidebarAgent | null; head: boolean };

/** A folder as herdr-web wrote it in a dispatch note: the home directory as ~. */
const shortCwd = (cwd: string | null | undefined): string => (cwd ?? "").replace(/^(?:\/data\d+)?\/home\/[^/]+(?=\/|$)/, "~");

/** One PC's workspaces as herdr-web's groups; MachineGroup draws it in place of its workspace list. */
export function TreeWorkspaces({ machine, snapshot, online, selectedPaneId, actions }: { machine: Machine; snapshot: SessionSnapshot | null; online: boolean; selectedPaneId: string | null; actions: AppActions }) {
  const t = useT();
  const api = useMachineApi();
  const activity = useSidebarActivity();
  const { needsOnly, terminalsOnlyOpen, folded } = useTreeState();
  const { branches } = useWorktreeBranches(snapshot, online, true);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [closing, setClosing] = useState<{ pane: PaneInfo; title: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  // a drag in the list: a workspace by its head, a tab by its row, and where it would land
  const [drag, setDrag] = useState<{ kind: "workspace" | "tab"; id: string; workspaceId: string } | null>(null);
  const [drop, setDrop] = useState<{ id: string; after: boolean } | null>(null);
  const endDrag = (): void => { setDrag(null); setDrop(null); };
  const groups = useMemo(() => treeGroups(snapshot), [snapshot]);
  // a newly opened pane unfolds its workspace once, when the roster knows it; then it folds as the user likes
  const unfoldedFor = useRef<string | null>(null);
  useEffect(() => {
    if (selectedPaneId === unfoldedFor.current || !snapshot?.panes.some((pane) => pane.pane_id === selectedPaneId)) return;
    unfoldedFor.current = selectedPaneId;
    const next = foldsOnOpen(state.folded, machine.id, snapshot, selectedPaneId);
    if (next) update({ folded: next });
  }, [selectedPaneId, snapshot, machine.id]);
  const longRuns = useLongRunPanes(machine.id, useMemo(() => snapshot?.panes.filter((pane) => pane.agent === "claude").map((pane) => pane.pane_id) ?? [], [snapshot]));
  const status = (pane: PaneInfo): AgentStatus | undefined => online ? activity.status(machine.id, pane) : undefined;
  const copy = (text: string, said: string) => void copyText(text).then((ok) => {
    setCopied(ok ? said : t("Couldn't copy: the browser refused the clipboard"));
    window.setTimeout(() => setCopied(null), 2500);
  });
  const run = (deed: () => Promise<unknown>) => { setError(null); deed().catch((e: unknown) => setError(e instanceof Error ? e.message : String(e))); };

  // a right-click opens the menu at the pointer, the ⋯ under itself
  const openMenu = (event: { preventDefault(): void; clientX: number; clientY: number; currentTarget: HTMLElement }, target: MenuTarget, atPointer: boolean) => {
    event.preventDefault();
    setMenu({ ...target, anchor: event.currentTarget, ...(atPointer ? { point: { x: event.clientX, y: event.clientY } } : {}) });
  };

  // `under`: a pane of a split tab under the tab's first one; a tab's own row is its head
  const row = (pane: PaneInfo, lead: ReactNode, title: string, extra: ReactNode, agent: SidebarAgent | null, trail: ReactNode = null, under = false) => {
    const terminal = agent === null;
    const selected = pane.pane_id === selectedPaneId;
    const target: MenuTarget = { kind: "pane", pane, title, agent, head: !under };
    return <div key={pane.pane_id} className={`tree-row${selected ? " is-active" : ""}${terminal ? " is-terminal" : ""}${under ? " is-under" : ""}`}
      onContextMenu={(event) => openMenu(event, target, true)}>
      <button type="button" className="tree-row-main" disabled={!online} aria-current={selected ? "true" : undefined}
        title={[title, pane.cwd].filter(Boolean).join("\n")} onClick={() => actions.selectPane(pane.pane_id)}
        draggable={online}
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData(PANE_DRAG_TYPE, paneDragData({ machineId: machine.id, paneId: pane.pane_id }));
          // a tab's own row also moves the tab among its workspace's; dropped on the pane area it still opens in a half
          if (!under) setDrag({ kind: "tab", id: pane.tab_id, workspaceId: pane.workspace_id });
        }}
        onDragEnd={endDrag}>
        {lead}
        <span className="tree-row-name"><span className="tree-row-title">{title}</span>{extra}</span>
        {trail}
      </button>
      {/* kept drawn while its menu is open (TreeSidebar.css): the menu is placed against it, and a hidden one sits at 0,0 */}
      <button type="button" className="tree-row-more" aria-label={t("Actions for {title}", { title })} aria-haspopup="menu"
        aria-expanded={menu?.kind === "pane" && menu.pane.pane_id === pane.pane_id && !menu.point}
        onClick={(event) => openMenu(event, target, false)}><Ellipsis aria-hidden="true" /></button>
    </div>;
  };

  const agentRow = (entry: SidebarAgent, place: string | null, under = false) => {
    const { pane, agent } = entry;
    const title = pane.label?.trim() || agent?.title?.trim() || pane.title?.trim() || displayPaneTitle(pane);
    const name = agent?.name?.trim() || null;
    const mark = paneMark(entry);
    const known = knownStatus(status(pane));
    return row(pane, <><span className="tree-dot-slot"><StateDot status={online ? known : null} /></span><span className="tree-kind" aria-hidden="true">{mark !== null ? <AgentMark agent={mark} size={14} /> : <Terminal />}</span></>, title,
      <>
        {name && <span className="tree-row-agent-name">@{name}</span>}
        {place && <small>{place} · {known === "blocked" ? t("Waits for your answer") : t("Finished, not seen yet")}</small>}
      </>, entry,
      // subagents and background commands still running: an agent at rest may still be waiting on them
      <>{longRuns[pane.pane_id] && <span className="tree-long-run" title={t("Compacts at {size} tokens (long run)", { size: windowLabel(longRuns[pane.pane_id]!) })}>{windowLabel(longRuns[pane.pane_id]!)}</span>}
        <BackgroundBadge count={online ? pane.background_tasks : 0} /></>, under);
  };

  // an empty dot slot keeps a terminal's mark in line with the agents'
  const terminalRow = (pane: PaneInfo, under = false) => row(pane, <><span className="tree-dot-slot" aria-hidden="true" /><span className="tree-kind is-terminal" aria-hidden="true"><Terminal /></span></>, displayPaneTitle(pane), null, null, null, under);

  // herdr-web's copies: the pane's id and name, and how another agent hands this one a task over herdr's CLI
  const paneCopies = (open: Extract<Menu, { kind: "pane" }>): RowMenuItem[] => {
    const name = open.agent?.agent?.name?.trim() || null;
    const target = name ?? open.pane.pane_id;
    const kind = open.agent?.agentLabel ?? open.agent?.canonicalAgent ?? "agent";
    const who = t("{kind} “{title}” in {cwd}", { kind, title: open.title, cwd: shortCwd(open.pane.cwd) });
    return [
      { id: "copy-id", label: t("Copy the pane ID"), hint: open.pane.pane_id, icon: Copy, run: () => copy(open.pane.pane_id, t("Copied to the clipboard")) },
      ...(name ? [{ id: "copy-name", label: t("Copy the agent's name"), hint: name, icon: Copy, run: () => copy(name, t("Copied to the clipboard")) }] : []),
      ...(open.agent ? [
        { id: "copy-dispatch", label: t("Copy the dispatch command"), icon: Send,
          run: () => copy(`herdr agent prompt ${target} "${t("describe the task here")}" --wait --timeout 600000`, t("Dispatch command copied")) },
        { id: "copy-instructions", label: t("Copy dispatch instructions (for another agent)"), icon: Users,
          run: () => copy(t("Hand this task to the herdr agent {target} ({who}): first check it is idle with `herdr agent get {target}`, then send it with `herdr agent prompt {target} \"<task>\" --wait --timeout 600000`, and read the result with `herdr agent read {target}`. See `herdr --skill` for details.", { target, who }), t("Dispatch instructions copied: paste them into another session")) },
      ] : []),
    ];
  };

  // the strip is not drawn (the rows are the tabs): a tab's head row moves the tab, as the strip's menu did
  const tabMoves = (open: Extract<Menu, { kind: "pane" }>): RowMenuItem[] => {
    if (!open.head || !snapshot) return [];
    const ids = snapshot.tabs.filter((tab) => tab.workspace_id === open.pane.workspace_id).map((tab) => tab.tab_id);
    return ([[-1, t("Move the tab up"), ArrowUp], [1, t("Move the tab down"), ArrowDown]] as const).flatMap(([direction, label, icon]) => {
      const boundary = adjacentTabBoundary(ids, open.pane.tab_id, direction);
      return boundary === null ? [] : [{ id: direction < 0 ? "move-up" : "move-down", label, icon, divider: direction < 0 || ids.indexOf(open.pane.tab_id) === 0,
        run: () => run(() => api.moveTab(open.pane.tab_id, boundary)) }];
    });
  };
  // on this PC a split asks what it runs, as a + does; another PC's bundle splits to a shell
  const split = (pane: PaneInfo, direction: "right" | "down") => machine.id === "local"
    ? openQuickTab({ machineId: machine.id, workspaceId: pane.workspace_id, split: { paneId: pane.pane_id, direction } })
    : run(async () => { const made = await api.splitPane(pane.pane_id, direction, true); actions.selectPane(made.pane_id); });

  const menuItems = (open: Menu): RowMenuItem[] => open.kind === "workspace" ? [
    { id: "new-tab", label: t("New terminal tab in {name}", { name: open.workspace.label }), icon: Plus, run: () => run(() => actions.openTerminalTab({ machineId: machine.id, workspaceId: open.workspace.workspace_id })) },
    { id: "new-agent-tab", label: t("Start an agent here…"), icon: SquarePen, run: () => actions.openNewTab({ machineId: machine.id, workspaceId: open.workspace.workspace_id }) },
    { id: "history", label: t("Earlier sessions here"), icon: History, run: () => actions.openSessionHistory({ machineId: machine.id, workspaceId: open.workspace.workspace_id }) },
    { id: "rename", label: t("Rename the workspace"), icon: Pencil, run: () => {
      const label = window.prompt(t("Rename the workspace"), open.workspace.label)?.trim();
      if (label && label !== open.workspace.label) run(() => api.renameWorkspace(open.workspace.workspace_id, label));
    } },
  ] : [
    ...paneCopies(open),
    ...tabMoves(open),
    { id: "split-right", label: t("Split it to the right"), divider: !open.head || tabMoves(open).length === 0, icon: Columns2, run: () => split(open.pane, "right") },
    { id: "split-down", label: t("Split it below"), icon: Rows2, run: () => split(open.pane, "down") },
    { id: "rename", label: t("Rename the pane"), divider: true, icon: Pencil, run: () => {
      const label = window.prompt(t("Rename the pane"), open.title)?.trim();
      if (label && label !== open.title) run(() => api.renamePane(open.pane.pane_id, label));
    } },
    { id: "close", label: t("Close the pane"), icon: X, danger: true, divider: true, run: () => setClosing({ pane: open.pane, title: open.title }) },
  ];

  if (!snapshot) return <div className="machine-workspaces tree-workspaces"><p className="tree-empty" role="status">{t("Loading this PC's workspaces…")}</p></div>;

  let body: ReactNode;
  if (needsOnly) {
    const needy = groups.flatMap(({ workspace, agents }) => agents.filter(({ pane }) => needsYou(status(pane))).map((entry) => ({ entry, workspace })))
      // a question first, then the answers not seen yet
      .sort((left, right) => Number(knownStatus(status(left.entry.pane)) === "done") - Number(knownStatus(status(right.entry.pane)) === "done"));
    body = needy.length === 0 ? <p className="tree-empty">{t("Nothing waits on you here")}</p> : needy.map(({ entry, workspace }) => agentRow(entry, workspace.label));
  } else {
    const { withAgents, terminalsOnly } = splitGroups(groups);
    const holds = (panes: readonly PaneInfo[]): boolean => panes.some((pane) => pane.pane_id === selectedPaneId);
    const branchOf = (workspace: WorkspaceInfo): ReactNode => {
      const branch = branches.get(workspace.workspace_id)?.branch ?? null;
      return branch && branch !== workspace.label ? <span className="tree-head-branch">{branch}</span> : null;
    };
    /** `current`: folded over the open pane, drawn as the open pane's row is */
    const head = (workspace: WorkspaceInfo, toggle: ReactNode, current = false) => {
      const addLabel = t("New tab in {name}", { name: workspace.label });
      return <div className={`tree-head${current ? " is-current" : ""}`} onContextMenu={(event) => openMenu(event, { kind: "workspace", workspace }, true)}>
        {toggle}
        <button type="button" className="tree-add" aria-label={addLabel} title={addLabel} disabled={!online}
          onClick={() => openQuickTab({ machineId: machine.id, workspaceId: workspace.workspace_id })}><Plus aria-hidden="true" /></button>
      </div>;
    };
    // herdr's insert index counts the boundaries before the moved one is taken out (lib/tabOrder.ts)
    const dropZone = (kind: "workspace" | "tab", id: string, workspaceId: string) => ({
      onDragOver: (event: DragEvent<HTMLElement>) => {
        if (!drag || drag.kind !== kind || drag.id === id || (kind === "tab" && drag.workspaceId !== workspaceId)) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = "move";
        const box = event.currentTarget.getBoundingClientRect();
        const after = event.clientY > box.top + box.height / 2;
        if (drop?.id !== id || drop.after !== after) setDrop({ id, after });
      },
      onDragLeave: (event: DragEvent<HTMLElement>) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDrop((current) => current?.id === id ? null : current);
      },
      onDrop: (event: DragEvent<HTMLElement>) => {
        if (!drag || drag.kind !== kind || drop?.id !== id) return;
        event.preventDefault();
        event.stopPropagation();
        const ids = kind === "workspace" ? snapshot.workspaces.map((entry) => entry.workspace_id)
          : snapshot.tabs.filter((tab) => tab.workspace_id === workspaceId).map((tab) => tab.tab_id);
        const from = ids.indexOf(drag.id);
        const boundary = ids.indexOf(id) + (drop.after ? 1 : 0);
        const moved = drag.id;
        endDrag();
        if (from < 0 || boundary === from || boundary === from + 1) return;
        run(() => kind === "workspace" ? api.moveWorkspace(moved, boundary) : api.moveTab(moved, boundary));
      },
    });
    const dropMark = (id: string): string => drop?.id === id ? (drop.after ? " is-drop-after" : " is-drop-before") : "";
    const agentGroups = withAgents.map(({ workspace, agents, terminals }) => {
      const agentOf = new Map(agents.map((entry) => [entry.pane.pane_id, entry]));
      const terminalIds = new Set(terminals.map((pane) => pane.pane_id));
      const rowOf = (under: boolean) => (pane: PaneInfo): ReactNode => {
        const entry = agentOf.get(pane.pane_id);
        return entry ? agentRow(entry, null, under) : terminalIds.has(pane.pane_id) ? terminalRow(pane, under) : null;
      };
      const key = foldKey(machine.id, workspace.workspace_id);
      const holdsSelection = holds([...agents.map(({ pane }) => pane), ...terminals]);
      const open = !folded.has(key);
      const hot = open || !online ? null : hottest(agents.map(({ pane }) => status(pane)));
      return <div key={workspace.workspace_id} className={`tree-group${dropMark(workspace.workspace_id)}`} role="group" aria-label={workspace.label}
        {...dropZone("workspace", workspace.workspace_id, workspace.workspace_id)}>
        {/* folded over the open pane: its head is drawn as the open pane's row is */}
        {head(workspace, <button type="button" className="tree-toggle" aria-expanded={open} aria-current={!open && holdsSelection ? "true" : undefined} draggable={online}
          onDragStart={(event) => {
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("application/x-ovis-workspace", workspace.workspace_id);
            setDrag({ kind: "workspace", id: workspace.workspace_id, workspaceId: workspace.workspace_id });
          }}
          onDragEnd={endDrag} onClick={() => {
          const next = new Set(folded);
          if (open) next.add(key); else next.delete(key);
          update({ folded: next });
        }}>
          <ChevronRight className="tree-chevron" aria-hidden="true" />
          {hot && <StateDot status={hot} />}
          <span className="tree-head-name">{workspace.label}</span>
          {branchOf(workspace)}
        </button>, !open && holdsSelection)}
        {open && tabRows(snapshot, workspace.workspace_id, (pane) => agentOf.has(pane.pane_id) || terminalIds.has(pane.pane_id) ? pane : null)
          .map(({ tab, head, under }) => <div key={tab.tab_id} className={`tree-tab${dropMark(tab.tab_id)}`} role="group" aria-label={tabLabel(tab, t)}
            {...dropZone("tab", tab.tab_id, workspace.workspace_id)}>
            {rowOf(false)(head)}{under.map(rowOf(true))}
          </div>)}
      </div>;
    });
    // a workspace of terminals alone is one line under the rest: its name opens the pane last viewed
    // there, and while it holds the open pane the line is lit and, past one, its terminals show beneath it
    const restHolds = terminalsOnly.some(({ terminals }) => holds(terminals));
    const restOpen = terminalsOnlyOpen || restHolds;
    const rest = terminalsOnly.length === 0 ? null : <div className="tree-group tree-rest" role="group" aria-label={t("Terminals only")}>
      <div className="tree-head">
        <button type="button" className="tree-toggle" aria-expanded={restOpen} onClick={() => update({ terminalsOnlyOpen: !restOpen })}>
          <ChevronRight className="tree-chevron" aria-hidden="true" />
          <span className="tree-head-name">{t("Terminals only")}</span>
          <span className="tree-rest-count">{terminalsOnly.length}</span>
        </button>
      </div>
      {restOpen && terminalsOnly.map(({ workspace, terminals }) => {
        const holdsSelection = holds(terminals);
        const focused = snapshot.layouts?.find((layout) => layout.tab_id === workspace.active_tab_id)?.focused_pane_id;
        const target = frontPane(terminals, lastViewedPane("workspace", machine.id, workspace.workspace_id), focused);
        return <div key={workspace.workspace_id} className={`tree-rest-workspace${holdsSelection ? " is-open" : ""}`} role="group" aria-label={workspace.label}>
          {head(workspace, <button type="button" className="tree-toggle" disabled={!online || !target} aria-current={holdsSelection ? "true" : undefined}
            onClick={() => { if (target) actions.selectPane(target.pane_id); }}>
            <span className="tree-kind is-terminal" aria-hidden="true"><Terminal /></span>
            <span className="tree-head-name">{workspace.label}</span>
            {branchOf(workspace)}
          </button>)}
          {holdsSelection && terminals.length > 1 && terminals.map((pane) => {
            // its shell is named after the folder, as the workspace is: the tab tells them apart
            const tab = snapshot.tabs.find((candidate) => candidate.tab_id === pane.tab_id);
            return row(pane, <span className="tree-kind is-terminal" aria-hidden="true"><Terminal /></span>, tab ? tabLabel(tab, t) : displayPaneTitle(pane), null, null);
          })}
        </div>;
      })}
    </div>;
    body = <>{agentGroups}{rest}</>;
  }

  return <div className="machine-workspaces tree-workspaces">
    {body}
    {error && <p className="machine-error" role="alert">{error}</p>}
    {copied && <p className="tree-copied" role="status">{copied}</p>}
    {menu && <RowMenu anchor={menu.anchor} point={menu.point} title={menu.kind === "workspace" ? menu.workspace.label : menu.title} onClose={() => setMenu(null)} items={menuItems(menu)} />}
    {closing && <ConfirmDialog title={t("Close the pane")} body={t("Closes {title} and ends what runs in it.", { title: closing.title })} confirmLabel={t("Close the pane")}
      // the dialog stays until its caller drops it: a confirmed close drops it here
      onConfirm={async () => { await api.closePane(closing.pane.pane_id); setClosing(null); }} onClose={() => setClosing(null)} />}
  </div>;
}
