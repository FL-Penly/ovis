/**
 * Downstream (FL-Penly/ovis, DOWNSTREAM.md): what ⌘T and a tree workspace's + open. A short list, a
 * terminal first and then the PC's installed agents; a pick opens a tab in the workspace running it,
 * with the agent's own defaults (no model, level or first message) and Settings' launch mode. The
 * full dialog stays in the workspace's menu for anything more.
 */
import { useEffect, useId, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Terminal } from "lucide-react";
import type { AgentKind } from "../../shared/agents.ts";
import type { AppActions } from "../lib/actions.ts";
import { launchAgent } from "../lib/agentLaunchMode.ts";
import { ApiError } from "../lib/api.ts";
import { useT } from "../lib/i18n.ts";
import { MachineContext, useMachineApi } from "../lib/machineContext.tsx";
import { useSettings } from "../lib/settings.ts";
import { useFocusTrap } from "../lib/useFocusTrap.ts";
import { AgentMark } from "./AgentMark.tsx";
import "./QuickTabPicker.css";

type Target = { machineId: string; workspaceId: string } | undefined;

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
    <Picker key={open.seq} target={open.target} actions={actions} onClose={() => set(null)} />
  </MachineContext.Provider>;
}

function Picker({ target, actions, onClose }: { target: Target; actions: AppActions; onClose(): void }) {
  const t = useT();
  const id = useId();
  const { settings } = useSettings();
  const { fetchAgentKinds } = useMachineApi();
  const [agents, setAgents] = useState<AgentKind[] | null>(null);
  const [active, setActive] = useState(0);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const surface = useFocusTrap<HTMLDivElement>(true);
  useEffect(() => {
    let live = true;
    // an agent the PC does not find is left out; an older bridge that does not say is listed
    fetchAgentKinds().then((list) => { if (live) setAgents(list.filter((agent) => agent.installed !== false)); }, () => { if (live) setAgents([]); });
    return () => { live = false; };
  }, [fetchAgentKinds]);
  const options: AgentKind[] = [{ kind: "", label: t("Terminal") }, ...(agents ?? [])];

  const pick = (option: AgentKind): void => {
    if (pending !== null) return;
    setPending(option.label);
    setError(null);
    actions.openTerminalTab(target, option.kind ? launchAgent(option.kind, settings) : null).then(onClose, (reason: unknown) => {
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
      else if (/^[1-9]$/.test(event.key) && !event.metaKey && !event.ctrlKey && !event.altKey && Number(event.key) <= options.length) pick(options[Number(event.key) - 1]!);
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
        <h2 className="quick-tab-title" id={`${id}-title`}>{t("New tab")}</h2>
        <div className="quick-tab-list" role="listbox" aria-labelledby={`${id}-title`} aria-activedescendant={`${id}-${active}`}>
          {options.map((option, at) => <button key={option.kind || "terminal"} id={`${id}-${at}`} type="button" role="option" aria-selected={at === active}
            className={`quick-tab-option${at === active ? " is-active" : ""}`} disabled={pending !== null}
            onMouseEnter={() => setActive(at)} onClick={() => pick(option)}>
            <span className="quick-tab-mark" aria-hidden="true">{option.kind ? <AgentMark agent={option.kind} size={16} /> : <Terminal />}</span>
            <span className="quick-tab-label">{option.label}</span>
            {at < 9 && <kbd className="quick-tab-key">{at + 1}</kbd>}
          </button>)}
          {agents === null && <p className="quick-tab-note" role="status">{t("Looking for agents…")}</p>}
        </div>
        {pending !== null && <p className="quick-tab-note" role="status">{t("Starting {agent}…", { agent: pending })}</p>}
        {error !== null && <p className="quick-tab-error" role="alert">{error}</p>}
        <p className="quick-tab-hint">{t("Enter opens · 1–9 picks · Esc closes")}</p>
      </div>
    </div>,
    document.body,
  );
}
