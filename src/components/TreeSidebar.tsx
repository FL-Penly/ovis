/**
 * Downstream (FL-Penly/ovis, DOWNSTREAM.md): the sidebar as herdr-web drew it. A New session and a
 * Needs you entry on top; then every workspace as a group head (its fold, its branch, a + for a new
 * tab, and while folded the dot of the agent that most asks for a look) over its agents, each with
 * a state dot, its mark and its title; plain terminals join their workspace when the list's
 * terminal switch is on. Needs you lists only the agents with an open question or an answer not
 * seen yet. MachineSidebar draws it in place of each PC's workspace list and the Agents list while
 * the layout is "tree"; the footer's layout button switches back to upstream's.
 */
import { useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { BellRing, ChevronRight, ChevronsDownUp, ChevronsUpDown, Copy, Ellipsis, EyeOff, History, Send, Users, ListTree, PanelsTopLeft, Pencil, Plus, SquarePen, Terminal, X } from "lucide-react";
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
import { AgentMark } from "./AgentMark.tsx";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import { RowMenu, type RowMenuItem } from "./RowMenu.tsx";
import { displayPaneTitle } from "./Sidebar.tsx";
import "./TreeSidebar.css";

type Layout = "tree" | "classic";
interface TreeState { layout: Layout; needsOnly: boolean; showTerminals: boolean; hideAgentless: boolean; folded: ReadonlySet<string> }

const LAYOUT_KEY = "ovis-downstream:sidebar-layout";
const TERMINALS_KEY = "ovis-downstream:sidebar-terminals";
const AGENTLESS_KEY = "ovis-downstream:sidebar-hide-agentless";
const FOLD_KEY = "ovis-downstream:sidebar-folded";

const stored = (key: string): string | null => { try { return localStorage.getItem(key); } catch { return null; } };
const store = (key: string, value: string): void => { try { localStorage.setItem(key, value); } catch { /* storage denied: kept for this page */ } };
function storedFolds(): Set<string> {
  try { return new Set(JSON.parse(stored(FOLD_KEY) ?? "[]") as string[]); } catch { return new Set(); }
}

let state: TreeState = {
  layout: stored(LAYOUT_KEY) === "classic" ? "classic" : "tree",
  needsOnly: false,
  showTerminals: stored(TERMINALS_KEY) === "1",
  // on unless turned off: a workspace without an agent (a plugin's, a spare shell) is rarely what the list is for
  hideAgentless: stored(AGENTLESS_KEY) !== "0",
  folded: storedFolds(),
};
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const current = (): TreeState => state;
function update(next: Partial<TreeState>): void {
  state = { ...state, ...next };
  store(LAYOUT_KEY, state.layout);
  store(TERMINALS_KEY, state.showTerminals ? "1" : "0");
  store(AGENTLESS_KEY, state.hideAgentless ? "1" : "0");
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
  return <button type="button" className="btn btn-ghost sidebar-footer-action tree-layout-toggle" aria-label={label} title={label}
    onClick={() => update({ layout: tree ? "classic" : "tree", needsOnly: false })}>
    {tree ? <PanelsTopLeft aria-hidden="true" /> : <ListTree aria-hidden="true" />}
  </button>;
}

/** The top of the list: New session, Needs you with its count, and the list's head with its fold-all and terminal switches. */
export function TreeNav({ machines, onNew }: { machines: Machine[]; onNew(): void }) {
  const t = useT();
  const { needsOnly, showTerminals, hideAgentless, folded } = useTreeState();
  const activity = useSidebarActivity();
  const online = machines.filter((machine) => machine.state === "connected");
  const count = online.reduce((sum, machine) => sum + sidebarAgents(machine.snapshot).filter(({ pane }) => needsYou(activity.status(machine.id, pane))).length, 0);
  const keys = online.flatMap((machine) => treeGroups(machine.snapshot).filter((group) => !hideAgentless || group.agents.length > 0)
    .map(({ workspace }) => foldKey(machine.id, workspace.workspace_id)));
  const anyOpen = keys.some((key) => !folded.has(key));
  const foldLabel = anyOpen ? t("Fold every workspace") : t("Unfold every workspace");
  const terminalsLabel = showTerminals ? t("Hide plain terminals") : t("Show plain terminals");
  const agentlessLabel = hideAgentless ? t("Show workspaces without an agent") : t("Hide workspaces without an agent");
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
        <button type="button" className="tree-tool" aria-pressed={hideAgentless} aria-label={agentlessLabel} title={agentlessLabel}
          onClick={() => update({ hideAgentless: !hideAgentless })}><EyeOff aria-hidden="true" /></button>
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
  const { needsOnly, showTerminals, hideAgentless, folded } = useTreeState();
  const { branches } = useWorktreeBranches(snapshot, online, true);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [closing, setClosing] = useState<{ pane: PaneInfo; title: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const groups = useMemo(() => treeGroups(snapshot), [snapshot]);
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

  const row = (pane: PaneInfo, lead: ReactNode, title: string, extra: ReactNode, agent: SidebarAgent | null) => {
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
      </>, entry);
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
    { id: "new-tab", label: t("New tab in {name}", { name: open.workspace.label }), icon: Plus, run: () => actions.openNewTab({ machineId: machine.id, workspaceId: open.workspace.workspace_id }) },
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
    body = groups.map(({ workspace, agents, terminals }) => {
      const key = foldKey(machine.id, workspace.workspace_id);
      const holdsSelection = [...agents.map(({ pane }) => pane), ...terminals].some((pane) => pane.pane_id === selectedPaneId);
      // one without an agent stays while it holds what is open
      if (hideAgentless && agents.length === 0 && !holdsSelection) return null;
      const open = !folded.has(key) || holdsSelection;
      const branch = branches.get(workspace.workspace_id)?.branch ?? null;
      const hot = open || !online ? null : hottest(agents.map(({ pane }) => status(pane)));
      const addLabel = t("New tab in {name}", { name: workspace.label });
      return <div key={workspace.workspace_id} className="tree-group" role="group" aria-label={workspace.label}>
        <div className="tree-head" onContextMenu={(event) => openMenu(event, { kind: "workspace", workspace }, true)}>
          <button type="button" className="tree-toggle" aria-expanded={open} onClick={() => {
            const next = new Set(folded);
            if (open) next.add(key); else next.delete(key);
            update({ folded: next });
          }}>
            <ChevronRight className="tree-chevron" aria-hidden="true" />
            {hot && <StateDot status={hot} />}
            <span className="tree-head-name">{workspace.label}</span>
            {branch && branch !== workspace.label && <span className="tree-head-branch">{branch}</span>}
          </button>
          <button type="button" className="tree-add" aria-label={addLabel} title={addLabel} disabled={!online}
            onClick={() => actions.openNewTab({ machineId: machine.id, workspaceId: workspace.workspace_id })}><Plus aria-hidden="true" /></button>
        </div>
        {open && <>
          {agents.map((entry) => agentRow(entry, null))}
          {showTerminals && terminals.map(terminalRow)}
        </>}
      </div>;
    });
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
