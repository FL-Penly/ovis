/**
 * Downstream (FL-Penly/ovis, DOWNSTREAM.md): herdr-style moves between workspaces and tabs.
 * ⌘↑ / ⌘↓ step to the previous / next workspace the sidebar shows, ⌘← / ⌘→ to the previous / next
 * tab of the open workspace, ⌘T opens a terminal tab in it and ⌘W closes the open tab (Ctrl+Alt in
 * place of ⌘ off a Mac, where Ctrl+arrows move by word). Both steps wrap around. In a text field with
 * text the arrows stay the field's (⌘← is the start of the line there); an empty field and the
 * terminal give them up, though a terminal with no other tab to step to keeps ⌘← / ⌘→ for the start
 * and end of its line. A browser tab keeps ⌘T and ⌘W for itself: they reach the page in the
 * installed app.
 */
import { useEffect, useRef, type MutableRefObject, type RefObject } from "react";
import type { PaneInfo, SessionSnapshot } from "../../shared/protocol.ts";
import type { AppActions } from "./actions.ts";
import { rosterPanes } from "./dagPane.ts";
import { lastViewedPane, rememberViewedPane } from "./lastViewedPane.ts";
import { isMacPlatform, keepsKeyForText } from "./shortcuts.ts";

export type NavMove = "workspace-previous" | "workspace-next" | "tab-previous" | "tab-next" | "terminal-tab" | "close-tab";

export function navMove(event: Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey" | "isComposing">, mac: boolean): NavMove | null {
  if (event.isComposing || event.shiftKey) return null;
  const mod = mac ? event.metaKey && !event.ctrlKey && !event.altKey : event.ctrlKey && event.altKey && !event.metaKey;
  if (!mod) return null;
  switch (event.key) {
    case "ArrowUp": return "workspace-previous";
    case "ArrowDown": return "workspace-next";
    case "ArrowLeft": return "tab-previous";
    case "ArrowRight": return "tab-next";
  }
  return event.code === "KeyT" ? "terminal-tab" : event.code === "KeyW" ? "close-tab" : null;
}

/** ⌘W's request: the tab strip showing this PC's tab closes it as its own close button would. */
const CLOSE_TAB_EVENT = "ovis:close-tab";
type CloseTabDetail = { machineId: string; tabId: string };

/**
 * For TabStrip: set `.current` to a close of the tab named (true when the strip holds it). Split
 * halves each have a strip; the first that holds the tab takes the request.
 */
export function useCloseTabKey(machineId: string): MutableRefObject<((tabId: string) => boolean) | null> {
  const close = useRef<((tabId: string) => boolean) | null>(null);
  useEffect(() => {
    const onClose = (event: Event): void => {
      const detail = (event as CustomEvent<CloseTabDetail>).detail;
      if (event.defaultPrevented || detail.machineId !== machineId) return;
      if (close.current?.(detail.tabId)) event.preventDefault();
    };
    window.addEventListener(CLOSE_TAB_EVENT, onClose);
    return () => window.removeEventListener(CLOSE_TAB_EVENT, onClose);
  }, [machineId]);
  return close;
}

/** The pane a workspace or tab opens on: the one last viewed there, else the one in front, else its first. */
function frontPane(panes: readonly PaneInfo[], viewed: string | undefined, focused: string | null | undefined): PaneInfo | undefined {
  const pick = (id: string | null | undefined) => (id ? panes.find((pane) => pane.pane_id === id) : undefined);
  return pick(viewed) ?? pick(focused) ?? panes.find((pane) => pane.focused) ?? panes[0];
}

/**
 * The pane a move lands on, or null when there is nowhere to go. `workspaces` is the order the
 * sidebar shows; the open pane's own workspace counts even when the sidebar would leave it out.
 */
export function navTarget(snapshot: SessionSnapshot, machineId: string, selectedPaneId: string | null, workspaces: readonly string[], move: Exclude<NavMove, "terminal-tab" | "close-tab">): string | null {
  const panes = rosterPanes(snapshot.panes, selectedPaneId);
  const selected = panes.find((pane) => pane.pane_id === selectedPaneId);
  const focusedIn = (tabId: string | undefined) => snapshot.layouts?.find((layout) => layout.tab_id === tabId)?.focused_pane_id;
  const step = <T,>(list: readonly T[], at: number, direction: number): T | undefined =>
    list.length === 0 ? undefined : list[((at < 0 ? (direction > 0 ? -1 : 0) : at) + direction + list.length) % list.length];
  const direction = move.endsWith("previous") ? -1 : 1;
  if (move.startsWith("workspace")) {
    const order = selected && !workspaces.includes(selected.workspace_id)
      ? snapshot.workspaces.map((workspace) => workspace.workspace_id).filter((id) => id === selected.workspace_id || workspaces.includes(id))
      : [...workspaces];
    const id = step(order, selected ? order.indexOf(selected.workspace_id) : -1, direction);
    const workspace = snapshot.workspaces.find((candidate) => candidate.workspace_id === id);
    if (!workspace || workspace.workspace_id === selected?.workspace_id) return null;
    return frontPane(panes.filter((pane) => pane.workspace_id === workspace.workspace_id),
      lastViewedPane("workspace", machineId, workspace.workspace_id), focusedIn(workspace.active_tab_id))?.pane_id ?? null;
  }
  if (!selected) return null;
  const tabs = snapshot.tabs.filter((tab) => tab.workspace_id === selected.workspace_id && panes.some((pane) => pane.tab_id === tab.tab_id));
  const tab = step(tabs, tabs.findIndex((candidate) => candidate.tab_id === selected.tab_id), direction);
  if (!tab || tab.tab_id === selected.tab_id) return null;
  return frontPane(panes.filter((pane) => pane.tab_id === tab.tab_id), lastViewedPane("tab", machineId, tab.tab_id), focusedIn(tab.tab_id))?.pane_id ?? null;
}

/** Whether a key went to a terminal (xterm's input). */
const inTerminal = (event: KeyboardEvent): boolean => event.target instanceof Element && event.target.closest(".xterm") !== null;

export function useNavShortcuts(actions: AppActions, snapshot: RefObject<SessionSnapshot | null>, machineId: string, selectedPaneId: string | null,
  sidebarWorkspaces: (snapshot: SessionSnapshot, selectedPaneId: string | null) => string[], enabled: boolean): void {
  // a step back to a workspace lands where it was left: upstream's classic sidebar remembers this, the tree does not
  useEffect(() => {
    const pane = snapshot.current?.panes.find((candidate) => candidate.pane_id === selectedPaneId);
    if (pane) rememberViewedPane("workspace", machineId, pane.workspace_id, pane.pane_id);
  }, [snapshot, machineId, selectedPaneId]);
  useEffect(() => {
    if (!enabled) return;
    const mac = isMacPlatform();
    const onKeyDown = (event: KeyboardEvent): void => {
      const move = navMove(event, mac);
      if (move === null || keepsKeyForText(event)) return;
      const roster = snapshot.current;
      const step = move === "terminal-tab" || move === "close-tab" || !roster ? null
        : navTarget(roster, machineId, selectedPaneId, sidebarWorkspaces(roster, selectedPaneId), move);
      // with no tab to step to, the terminal keeps ⌘← / ⌘→ for the start and end of its line
      if (step === null && (move === "tab-previous" || move === "tab-next") && inTerminal(event)) return;
      // the app's alone: neither the browser (⌘← is Back) nor the terminal gets it
      event.preventDefault();
      event.stopPropagation();
      if (event.repeat && (move === "terminal-tab" || move === "close-tab")) return;
      if (move === "terminal-tab") { void actions.openTerminalTab().catch(() => { /* herdr refused: nothing opens */ }); return; }
      if (!roster) return;
      if (move === "close-tab") {
        const tabId = roster.panes.find((pane) => pane.pane_id === selectedPaneId)?.tab_id;
        if (tabId) window.dispatchEvent(new CustomEvent<CloseTabDetail>(CLOSE_TAB_EVENT, { detail: { machineId, tabId }, cancelable: true }));
        return;
      }
      if (step !== null) actions.selectPane(step);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [actions, snapshot, machineId, selectedPaneId, sidebarWorkspaces, enabled]);
}
