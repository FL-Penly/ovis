/**
 * Downstream (FL-Penly/ovis, DOWNSTREAM.md): the sidebar as herdr-web drew it. A New session and a
 * Needs you entry on top; then every workspace as a group head (its fold, its branch, a + for a new
 * tab, and while folded the dot of the agent that most asks for a look) over its agents, each with
 * a state dot, its mark and its title; plain terminals join their workspace when the list's
 * terminal switch is on. A workspace with no agent waits folded in a Terminals only group under
 * the rest, opened by its head or while it holds the open pane. Needs you lists only the agents with an open question or an answer not
 * seen yet. MachineSidebar draws it in place of each PC's workspace list and the Agents list while
 * the layout is "tree"; the footer's layout button switches back to upstream's.
 */
import { useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { BellRing, ChevronRight, ChevronsDownUp, ChevronsUpDown, Copy, Ellipsis, History, Send, Users, ListTree, PanelsTopLeft, Pencil, Plus, SquarePen, Terminal, X } from "lucide-react";
import type { Machine } from "../../shared/machines.ts";
import type { AgentStatus, PaneInfo, SessionSnapshot, WorkspaceInfo } from "../../shared/protocol.ts";
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
import { AgentMark } from "./AgentMark.tsx";
import { openQuickTab } from "./QuickTabPicker.tsx";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import { RowMenu, type RowMenuItem } from "./RowMenu.tsx";
import { BackgroundBadge, displayPaneTitle } from "./Sidebar.tsx";
import { windowLabel } from "../../shared/long-run.ts";
import { useLongRunPanes } from "../lib/longRun.ts";
import "./TreeSidebar.css";

type Layout = "tree" | "classic";
interface TreeState { layout: Layout; needsOnly: boolean; showTerminals: boolean; terminalsOnlyOpen: boolean; folded: ReadonlySet<string> }

const LAYOUT_KEY = "ovis-downstream:sidebar-layout";
const TERMINALS_KEY = "ovis-downstream:sidebar-terminals";
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
  showTerminals: stored(TERMINALS_KEY) === "1",
  terminalsOnlyOpen: stored(TERMINALS_ONLY_KEY) === "1",
  folded: storedFolds(),
};
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const current = (): TreeState => state;
function update(next: Partial<TreeState>): void {
  state = { ...state, ...next };
  store(LAYOUT_KEY, state.layout);
  store(TERMINALS_KEY, state.showTerminals ? "1" : "0");
  store(TERMINALS_ONLY_KEY, state.terminalsOnlyOpen ? "1" : "0");
  store(FOLD_KEY, JSON.stringify([...state.folded]));
  for (const listener of listeners) listener();
}
const useTreeState = (): TreeState => useSyncExternalStore(subscribe, current, current);
const foldKey = (machineId: string, workspaceId: string): string => `${machineId}\u0000${workspaceId}`;

export const useTreeSidebar = (): boolean => useTreeState().layout === "tree";

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

/** The top of the list: New session, Needs you with its count, and the list's head with its fold-all and terminal switches. */
export function TreeNav({ machines, onNew }: { machines: Machine[]; onNew(): void }) {
  const t = useT();
  const { needsOnly, showTerminals, folded } = useTreeState();
  const activity = useSidebarActivity();
  const online = machines.filter((machine) => machine.state === "connected");
  const count = online.reduce((sum, machine) => sum + sidebarAgents(machine.snapshot).filter(({ pane }) => needsYou(activity.status(machine.id, pane))).length, 0);
  const keys = online.flatMap((machine) => splitGroups(treeGroups(machine.snapshot)).withAgents
    .map(({ workspace }) => foldKey(machine.id, workspace.workspace_id)));
  const anyOpen = keys.some((key) => !folded.has(key));
  const foldLabel = anyOpen ? t("Fold every workspace") : t("Unfold every workspace");
  const terminalsLabel = showTerminals ? t("Hide plain terminals") : t("Show plain terminals");
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
        <button type="button" className="tree-tool" aria-pressed={showTerminals} aria-label={terminalsLabel} title={terminalsLabel}
          onClick={() => update({ showTerminals: !showTerminals })}><Terminal aria-hidden="true" /></button>
      </div>}
    </div>
  </div>;
}

type Menu = { kind: "workspace"; workspace: WorkspaceInfo; anchor: HTMLElement; point?: { x: number; y: number } }
  | { kind: "pane"; pane: PaneInfo; title: string; agent: SidebarAgent | null; anchor: HTMLElement; point?: { x: number; y: number } };
type MenuTarget = { kind: "workspace"; workspace: WorkspaceInfo } | { kind: "pane"; pane: PaneInfo; title: string; agent: SidebarAgent | null };

/** A folder as herdr-web wrote it in a dispatch note: the home directory as ~. */
const shortCwd = (cwd: string | null | undefined): string => (cwd ?? "").replace(/^(?:\/data\d+)?\/home\/[^/]+(?=\/|$)/, "~");

/** One PC's workspaces as herdr-web's groups; MachineGroup draws it in place of its workspace list. */
export function TreeWorkspaces({ machine, snapshot, online, selectedPaneId, actions }: { machine: Machine; snapshot: SessionSnapshot | null; online: boolean; selectedPaneId: string | null; actions: AppActions }) {
  const t = useT();
  const api = useMachineApi();
  const activity = useSidebarActivity();
  const { needsOnly, showTerminals, terminalsOnlyOpen, folded } = useTreeState();
  const { branches } = useWorktreeBranches(snapshot, online, true);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [closing, setClosing] = useState<{ pane: PaneInfo; title: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const groups = useMemo(() => treeGroups(snapshot), [snapshot]);
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

  const row = (pane: PaneInfo, lead: ReactNode, title: string, extra: ReactNode, agent: SidebarAgent | null, trail: ReactNode = null) => {
    const terminal = agent === null;
    const selected = pane.pane_id === selectedPaneId;
    return <div key={pane.pane_id} className={`tree-row${selected ? " is-active" : ""}${terminal ? " is-terminal" : ""}`}
      onContextMenu={(event) => openMenu(event, { kind: "pane", pane, title, agent }, true)}>
      <button type="button" className="tree-row-main" disabled={!online} aria-current={selected ? "true" : undefined}
        title={[title, pane.cwd].filter(Boolean).join("\n")} onClick={() => actions.selectPane(pane.pane_id)}
        draggable={online}
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData(PANE_DRAG_TYPE, paneDragData({ machineId: machine.id, paneId: pane.pane_id }));
        }}>
        {lead}
        <span className="tree-row-name"><span className="tree-row-title">{title}</span>{extra}</span>
        {trail}
      </button>
      <button type="button" className="tree-row-more" aria-label={t("Actions for {title}", { title })} aria-haspopup="menu"
        onClick={(event) => openMenu(event, { kind: "pane", pane, title, agent }, false)}><Ellipsis aria-hidden="true" /></button>
    </div>;
  };

  const agentRow = (entry: SidebarAgent, place: string | null) => {
    const { pane, agent } = entry;
    const title = pane.label?.trim() || agent?.title?.trim() || pane.title?.trim() || displayPaneTitle(pane);
    const name = agent?.name?.trim() || null;
    const mark = paneMark(entry);
    const known = knownStatus(status(pane));
    return row(pane, <><StateDot status={online ? known : null} /><span className="tree-kind" aria-hidden="true">{mark !== null ? <AgentMark agent={mark} size={14} /> : <Terminal />}</span></>, title,
      <>
        {name && <span className="tree-row-agent-name">@{name}</span>}
        {place && <small>{place} · {known === "blocked" ? t("Waits for your answer") : t("Finished, not seen yet")}</small>}
      </>, entry,
      // subagents and background commands still running: an agent at rest may still be waiting on them
      <>{longRuns[pane.pane_id] && <span className="tree-long-run" title={t("Compacts at {size} tokens (long run)", { size: windowLabel(longRuns[pane.pane_id]!) })}>{windowLabel(longRuns[pane.pane_id]!)}</span>}
        <BackgroundBadge count={online ? pane.background_tasks : 0} /></>);
  };

  const terminalRow = (pane: PaneInfo) => row(pane, <span className="tree-kind is-terminal" aria-hidden="true"><Terminal /></span>, displayPaneTitle(pane), null, null);

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
    const head = (workspace: WorkspaceInfo, toggle: ReactNode) => {
      const addLabel = t("New tab in {name}", { name: workspace.label });
      return <div className="tree-head" onContextMenu={(event) => openMenu(event, { kind: "workspace", workspace }, true)}>
        {toggle}
        <button type="button" className="tree-add" aria-label={addLabel} title={addLabel} disabled={!online}
          onClick={() => openQuickTab({ machineId: machine.id, workspaceId: workspace.workspace_id })}><Plus aria-hidden="true" /></button>
      </div>;
    };
    const agentGroups = withAgents.map(({ workspace, agents, terminals }) => {
      const key = foldKey(machine.id, workspace.workspace_id);
      const holdsSelection = holds([...agents.map(({ pane }) => pane), ...terminals]);
      const open = !folded.has(key) || holdsSelection;
      const hot = open || !online ? null : hottest(agents.map(({ pane }) => status(pane)));
      return <div key={workspace.workspace_id} className="tree-group" role="group" aria-label={workspace.label}>
        {head(workspace, <button type="button" className="tree-toggle" aria-expanded={open} onClick={() => {
          const next = new Set(folded);
          if (open) next.add(key); else next.delete(key);
          update({ folded: next });
        }}>
          <ChevronRight className="tree-chevron" aria-hidden="true" />
          {hot && <StateDot status={hot} />}
          <span className="tree-head-name">{workspace.label}</span>
          {branchOf(workspace)}
        </button>)}
        {open && <>
          {agents.map((entry) => agentRow(entry, null))}
          {showTerminals && terminals.map(terminalRow)}
        </>}
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
      onConfirm={() => api.closePane(closing.pane.pane_id)} onClose={() => setClosing(null)} />}
  </div>;
}
