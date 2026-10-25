/**
 * Downstream (FL-Penly/ovis, DOWNSTREAM.md): what ⌘T and a tree workspace's + open. A short list, a
 * terminal first and then the PC's installed agents; a pick opens a tab in the workspace running it,
 * with the agent's own defaults (no model, level or first message) and Settings' launch mode. The
 * full dialog stays in the workspace's menu for anything more. On this PC, Claude Code has a second
 * row, a long run: the same start with a wider compact window (shared/long-run.ts). A split of a pane
 * on this PC asks the same list, and runs the pick in the new pane.
 */
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Terminal } from "lucide-react";
import type { AgentKind } from "../../shared/agents.ts";
import { LONG_RUN_ENV, LONG_RUN_WINDOW, windowLabel } from "../../shared/long-run.ts";
import type { AppActions } from "../lib/actions.ts";
import { launchAgent } from "../lib/agentLaunchMode.ts";
import { ApiError } from "../lib/api.ts";
import { useT } from "../lib/i18n.ts";
import { MachineContext, useMachineApi } from "../lib/machineContext.tsx";
import { useSettings } from "../lib/settings.ts";
import { useFocusTrap } from "../lib/useFocusTrap.ts";
import { AgentMark } from "./AgentMark.tsx";
import "./QuickTabPicker.css";

/** `split`: the list asks what a split of that pane runs instead of a new tab (this PC only, lib/splitLaunch.ts) */
type Target = { machineId: string; workspaceId: string; split?: { paneId: string; direction: "right" | "down" } } | undefined;
type Option = AgentKind & { long?: true };

let request: { target: Target; seq: number } | null = null;
let seq = 0;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const current = () => request;
const set = (next: typeof request): void => { request = next; for (const listener of listeners) listener(); };

/** Opens the list for a workspace, or for the open pane's workspace without one. */
export function openQuickTab(target?: Target): void { set({ target, seq: ++seq }); }

/** Mounted once in App: `machineId` is the selected PC, used when the list was opened without a target. */
export function QuickTabPicker({ actions, machineId }: { actions: AppActions; machineId: string }) {
  const open = useSyncExternalStore(subscribe, current, current);
  if (open === null) return null;
  return <MachineContext.Provider value={open.target?.machineId ?? machineId}>
    <Picker key={open.seq} target={open.target} local={(open.target?.machineId ?? machineId) === "local"} actions={actions} onClose={() => set(null)} />
  </MachineContext.Provider>;
}

function Picker({ target, local, actions, onClose }: { target: Target; local: boolean; actions: AppActions; onClose(): void }) {
  const t = useT();
  const id = useId();
  const { settings } = useSettings();
  const { fetchAgentKinds } = useMachineApi();
  const [agents, setAgents] = useState<AgentKind[] | null>(null);
  const [active, setActive] = useState(0);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rows = useRef<(HTMLButtonElement | null)[]>([]);
  const surface = useFocusTrap<HTMLDivElement>(true);
  useEffect(() => {
    let live = true;
    // an agent the PC does not find is left out; an older bridge that does not say is listed
    fetchAgentKinds().then((list) => { if (live) setAgents(list.filter((agent) => agent.installed !== false)); }, () => { if (live) setAgents([]); });
    return () => { live = false; };
  }, [fetchAgentKinds]);
  // another PC runs upstream's bundle, which starts no tab with an environment of its own
  const options: Option[] = [{ kind: "", label: t("Terminal") }, ...(agents ?? []).flatMap((agent): Option[] => local && agent.kind === "claude"
    ? [agent, { ...agent, label: `${agent.label} · ${t("long run {size}", { size: windowLabel(LONG_RUN_WINDOW) })}`, long: true }] : [agent])];
  // the focus sits on the highlighted row, so its ring and Enter name the same one
  useEffect(() => { rows.current[active]?.focus(); }, [active, agents]);

  const pick = (option: Option): void => {
    if (pending !== null) return;
    setPending(option.label);
    setError(null);
    const agent = option.kind ? launchAgent(option.kind, settings) : null;
    const env = option.long ? { [LONG_RUN_ENV]: String(LONG_RUN_WINDOW) } : undefined;
    const split = target?.split;
    const opened = split && actions.openSplit
      ? actions.openSplit({ machineId: target.machineId, paneId: split.paneId, direction: split.direction }, agent, env)
      : actions.openTerminalTab(target, agent, env);
    opened.then(onClose, (reason: unknown) => {
      setPending(null);
      setError(reason instanceof ApiError ? reason.detail : reason instanceof Error ? reason.message : String(reason));
    });
  };

  // the list's keys are its own while it is up; Escape also hides it while an agent starts, which goes on
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.isComposing) return;
      let handled = true;
      if (event.key === "Escape") onClose();
      else if (pending !== null) handled = false;
      else if (event.key === "ArrowDown") setActive((at) => (at + 1) % options.length);
      else if (event.key === "ArrowUp") setActive((at) => (at - 1 + options.length) % options.length);
      else if (event.key === "Enter") pick(options[active]!);
      else handled = false;
      if (!handled) return;
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  return createPortal(
    <div className="modal-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={surface} className="modal quick-tab" role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} tabIndex={-1}>
        <h2 className="quick-tab-title" id={`${id}-title`}>{target?.split ? t(target.split.direction === "right" ? "Split it to the right" : "Split it below") : t("New tab")}</h2>
        <div className="quick-tab-list" role="listbox" aria-labelledby={`${id}-title`} aria-activedescendant={`${id}-${active}`}>
          {options.map((option, at) => <button key={`${option.kind || "terminal"}${option.long ? ":long" : ""}`} ref={(row) => { rows.current[at] = row; }} id={`${id}-${at}`} type="button" role="option" aria-selected={at === active}
            className={`quick-tab-option${at === active ? " is-active" : ""}`} disabled={pending !== null}
            onMouseEnter={() => setActive(at)} onClick={() => pick(option)}>
            <span className="quick-tab-mark" aria-hidden="true">{option.kind ? <AgentMark agent={option.kind} size={16} /> : <Terminal />}</span>
            <span className="quick-tab-label">{option.label}</span>
          </button>)}
          {agents === null && <p className="quick-tab-note" role="status">{t("Looking for agents…")}</p>}
        </div>
        {pending !== null && <p className="quick-tab-note" role="status">{t("Starting {agent}…", { agent: pending })}</p>}
        {error !== null && <p className="quick-tab-error" role="alert">{error}</p>}
        <p className="quick-tab-hint">{t("↑↓ to choose · Enter opens · Esc closes")}</p>
      </div>
    </div>,
    document.body,
  );
}
