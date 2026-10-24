/**
 * Downstream (FL-Penly/ovis, DOWNSTREAM.md): the composer's mode chip for a Claude Code or Codex pane.
 * It shows the mode the agent's own footer shows (lib/agentMode.ts) and, on a press or Shift+Tab in the
 * composer, sends the agent Shift+Tab, its own key for the next mode. The key goes only while the input
 * box is on screen: over a dialog or menu Shift+Tab means something else. The screen is read through
 * the pane routes every PC already has, so a remote PC's pane gets the chip too.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { machinePath } from "../../shared/machines.ts";
import type { AgentStatus } from "../../shared/protocol.ts";
import { readAgentMode, type AgentMode } from "../lib/agentMode.ts";
import { useT, type Translate } from "../lib/i18n.ts";
import { useMachineId } from "../lib/machineContext.tsx";
import "./ModeChip.css";

const READ_EVERY_MS = 3000;
/** the agent redraws its footer a moment after the key: read again then, and once more for a slow one */
const READ_AFTER_KEY_MS = [350, 1200];

function modeWord(t: Translate, mode: AgentMode | null): string {
  switch (mode) {
    case "bypass permissions": return t("Bypass permissions mode");
    case "plan mode": return t("Plan mode");
    case "accept edits": return t("Accept edits mode");
    case "auto mode": return t("Auto mode");
    case "manual mode": return t("Manual mode");
    case "YOLO mode": return t("YOLO mode");
    default: return t("Default mode");
  }
}

type Shown = { mode: AgentMode | null; inputBox: boolean } | null;

export function ModeChip({ paneId, agent, agentStatus, disabled }: { paneId: string; agent: string | null; agentStatus?: AgentStatus; disabled: boolean }) {
  const t = useT();
  const machineId = useMachineId();
  const [shown, setShown] = useState<Shown>(null);
  const [note, setNote] = useState<string | null>(null);
  const chipRef = useRef<HTMLButtonElement>(null);
  const supported = agent === "claude" || agent === "codex";

  const read = useCallback(async (): Promise<Shown> => {
    const query = new URLSearchParams({ pane_id: paneId, source: "visible", format: "text" });
    const response = await fetch(machinePath(machineId, `pane/read?${query.toString()}`));
    if (!response.ok) return null;
    const body = await response.json() as { read?: { text?: unknown } };
    return typeof body.read?.text === "string" ? readAgentMode(body.read.text) : null;
  }, [paneId, machineId]);

  const refresh = useCallback(async (): Promise<void> => {
    const reading = await read().catch(() => null);
    // a dialog over the input box hides the footer: the mode last read stays shown meanwhile
    if (reading !== null) setShown((before) => reading.inputBox || before === null ? reading : { ...before, inputBox: false });
  }, [read]);

  useEffect(() => {
    if (!supported) { setShown(null); return; }
    void refresh();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, READ_EVERY_MS);
    return () => window.clearInterval(timer);
  }, [supported, refresh, agentStatus]);

  const cycle = useCallback(async (): Promise<void> => {
    if (disabled) return;
    setNote(null);
    const now = await read().catch(() => null);
    if (now === null || !now.inputBox) { setNote(t("Close what is open in the terminal first")); return; }
    const response = await fetch(machinePath(machineId, "pane/keys"), {
      method: "POST",
      headers: { "content-type": "application/json", "x-herdr-machine": "1" },
      body: JSON.stringify({ pane_id: paneId, keys: ["shift+tab"] }),
    }).catch(() => null);
    if (!response?.ok) { setNote(t("Couldn't switch the mode")); return; }
    for (const delay of READ_AFTER_KEY_MS) window.setTimeout(() => void refresh(), delay);
  }, [disabled, read, machineId, paneId, refresh, t]);

  // Shift+Tab in this pane's message box, unless its own / menu is open and takes the key
  useEffect(() => {
    if (!supported) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Tab" || !event.shiftKey || event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target;
      if (!(target instanceof HTMLTextAreaElement) || target.getAttribute("aria-expanded") === "true") return;
      if (!chipRef.current?.closest(".composer")?.contains(target)) return;
      event.preventDefault();
      event.stopPropagation();
      void cycle();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [supported, cycle]);

  if (!supported || shown === null) return null;
  const word = modeWord(t, shown.mode);
  const title = note ?? t("Mode: {mode}. Press or Shift+Tab for the next one", { mode: word });
  return <button ref={chipRef} type="button" className={`composer-mode-chip${shown.mode ? ` is-${shown.mode.replace(/\s+/g, "-").toLowerCase()}` : ""}`}
    title={title} aria-label={title} disabled={disabled} onClick={() => void cycle()}>
    {word}
  </button>;
}
