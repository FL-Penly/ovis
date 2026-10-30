/**
 * Downstream (FL-Penly/ovis, DOWNSTREAM.md): the composer's mode chip for a Claude Code or Codex pane.
 * It shows the mode the agent's own footer shows (lib/agentMode.ts). A press opens the agent's modes;
 * picking one presses the agent's own Shift+Tab, which steps to the next mode, until the footer shows
 * the one picked. Shift+Tab in the composer steps once. A key goes only while the input box is on
 * screen: over a dialog or menu Shift+Tab means something else. The screen is read through the pane
 * routes every PC already has, so a remote PC's pane gets the chip too.
 */
import { CircleDot, ClipboardList, FilePen, Hand, ShieldOff, Sparkles, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { machinePath } from "../../shared/machines.ts";
import type { AgentStatus } from "../../shared/protocol.ts";
import { readAgentMode, type AgentMode } from "../lib/agentMode.ts";
import { useT, type Translate } from "../lib/i18n.ts";
import { useMachineId } from "../lib/machineContext.tsx";
import { RowMenu } from "./RowMenu.tsx";
import "./ModeChip.css";

const READ_EVERY_MS = 3000;
/** the agent redraws its footer a moment after the key: read again then, and once more for a slow one */
const READ_AFTER_KEY_MS = [350, 1200];
/** while stepping to a picked mode: how long a press gets to show in the footer, and how many presses at most */
const STEP_SETTLE_MS = 450;
const STEP_READS = 4;
const MAX_STEPS = 8;

/** null is the default mode. Codex steps only between its collaboration modes; YOLO is its approval mode, shown apart. */
const CHOICES: Record<"claude" | "codex", { mode: AgentMode | null; icon: LucideIcon }[]> = {
  claude: [
    { mode: null, icon: CircleDot },
    { mode: "accept edits", icon: FilePen },
    { mode: "plan mode", icon: ClipboardList },
    { mode: "auto mode", icon: Sparkles },
    { mode: "manual mode", icon: Hand },
    { mode: "bypass permissions", icon: ShieldOff },
  ],
  codex: [
    { mode: null, icon: CircleDot },
    { mode: "plan mode", icon: ClipboardList },
  ],
};

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

/** the mode Shift+Tab steps through: Codex's YOLO is its approval mode, so it reads as the default collaboration mode */
const steppedMode = (agent: string, mode: AgentMode | null): AgentMode | null => agent === "codex" && mode === "YOLO mode" ? null : mode;

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

type Shown = { mode: AgentMode | null; inputBox: boolean } | null;

/**
 * The modes a pane's Shift+Tab was seen to skip, by PC and pane. Which modes cycle depends on how the
 * session started (one started in bypass permissions has no default mode), so a pick that went all the
 * way round without reaching its mode, or a full round that never showed some, takes them off the menu.
 */
const missingModes = new Map<string, Set<AgentMode | null>>();
const NOTE_MS = 5000;

export function ModeChip({ paneId, agent, agentStatus, disabled }: { paneId: string; agent: string | null; agentStatus?: AgentStatus; disabled: boolean }) {
  const t = useT();
  const machineId = useMachineId();
  const [shown, setShown] = useState<Shown>(null);
  const [note, setNote] = useState<string | null>(null);
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const [stepping, setStepping] = useState(false);
  const chipRef = useRef<HTMLButtonElement>(null);
  const paneKey = `${machineId}\u0000${paneId}\u0000${agent ?? ""}`;
  const supported = agent === "claude" || agent === "codex";

  const read = useCallback(async (): Promise<Shown> => {
    const query = new URLSearchParams({ pane_id: paneId, source: "visible", format: "text" });
    const response = await fetch(machinePath(machineId, `pane/read?${query.toString()}`));
    if (!response.ok) return null;
    const body = await response.json() as { read?: { text?: unknown } };
    return typeof body.read?.text === "string" ? readAgentMode(body.read.text) : null;
  }, [paneId, machineId]);

  const show = useCallback((reading: Shown): void => {
    // a dialog over the input box hides the footer: the mode last read stays shown meanwhile
    if (reading !== null) setShown((before) => reading.inputBox || before === null ? reading : { ...before, inputBox: false });
  }, []);

  const refresh = useCallback(async (): Promise<void> => { show(await read().catch(() => null)); }, [read, show]);

  useEffect(() => {
    if (!supported) { setShown(null); return; }
    void refresh();
    const timer = setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, READ_EVERY_MS);
    return () => clearInterval(timer);
  }, [supported, refresh, agentStatus]);

  const pressShiftTab = useCallback(async (): Promise<boolean> => {
    const response = await fetch(machinePath(machineId, "pane/keys"), {
      method: "POST",
      headers: { "content-type": "application/json", "x-herdr-machine": "1" },
      body: JSON.stringify({ pane_id: paneId, keys: ["shift+tab"] }),
    }).catch(() => null);
    return response?.ok === true;
  }, [machineId, paneId]);

  const settle = useCallback(async (before: AgentMode | null): Promise<Shown> => {
    let reading: Shown = null;
    for (let i = 0; i < STEP_READS; i++) {
      await wait(STEP_SETTLE_MS);
      reading = await read().catch(() => null);
      if (reading === null || !reading.inputBox || reading.mode !== before) break;
    }
    return reading;
  }, [read]);

  const step = useCallback(async (): Promise<void> => {
    if (disabled || stepping) return;
    setNote(null);
    const now = await read().catch(() => null);
    if (now === null || !now.inputBox) { setNote(t("Close what is open in the terminal first")); return; }
    if (!await pressShiftTab()) { setNote(t("Couldn't switch the mode")); return; }
    for (const delay of READ_AFTER_KEY_MS) setTimeout(() => void refresh(), delay);
  }, [disabled, stepping, read, pressShiftTab, refresh, t]);

  /** Shift+Tab until the footer shows `target`; back at the mode it started from, the session has no such mode. */
  const pick = useCallback(async (target: AgentMode | null): Promise<void> => {
    if (disabled || stepping || agent === null) return;
    setNote(null);
    setStepping(true);
    try {
      let reading = await read().catch(() => null);
      if (reading === null || !reading.inputBox) { setNote(t("Close what is open in the terminal first")); return; }
      const start = steppedMode(agent, reading.mode);
      let current = start;
      const seen = new Set<AgentMode | null>([start]);
      for (let presses = 0; current !== target; presses++) {
        if (presses >= MAX_STEPS || (presses > 0 && current === start)) {
          if (current === start) {
            const missing = CHOICES[agent as "claude" | "codex"].map(({ mode }) => mode).filter((mode) => !seen.has(mode));
            missingModes.set(paneKey, new Set(missing));
          }
          setNote(t("This session does not offer {mode}", { mode: modeWord(t, target) }));
          break;
        }
        if (!await pressShiftTab()) { setNote(t("Couldn't switch the mode")); break; }
        reading = await settle(current);
        if (reading === null || !reading.inputBox) { setNote(t("Close what is open in the terminal first")); break; }
        show(reading);
        current = steppedMode(agent, reading.mode);
        seen.add(current);
      }
    } finally {
      setStepping(false);
      void refresh();
    }
  }, [disabled, stepping, agent, paneKey, read, pressShiftTab, settle, show, refresh, t]);

  useEffect(() => {
    if (note === null) return;
    const timer = setTimeout(() => setNote(null), NOTE_MS);
    return () => clearTimeout(timer);
  }, [note]);

  // Shift+Tab in this pane's message box steps once, unless its own / menu is open and takes the key
  useEffect(() => {
    if (!supported) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Tab" || !event.shiftKey || event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target;
      if (!(target instanceof HTMLTextAreaElement) || target.getAttribute("aria-expanded") === "true") return;
      if (!chipRef.current?.closest(".composer")?.contains(target)) return;
      event.preventDefault();
      event.stopPropagation();
      void step();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [supported, step]);

  if (!supported || shown === null || agent === null) return null;
  const word = modeWord(t, shown.mode);
  const current = steppedMode(agent, shown.mode);
  const title = note ?? (stepping ? t("Switching the mode…") : t("Mode: {mode}. Press to pick another, or Shift+Tab for the next one", { mode: word }));
  return <>
    <button ref={chipRef} type="button" className={`composer-mode-chip${shown.mode ? ` is-${shown.mode.replace(/\s+/g, "-").toLowerCase()}` : ""}${stepping ? " is-stepping" : ""}`}
      title={title} aria-label={title} aria-haspopup="menu" aria-expanded={menu !== null} disabled={disabled}
      onClick={(event) => setMenu(menu ? null : event.currentTarget)}>
      {word}
    </button>
    {menu && <RowMenu anchor={menu} title={t("Switch mode")} align="end" onClose={() => setMenu(null)}
      items={CHOICES[agent as "claude" | "codex"].filter(({ mode }) => mode === current || !missingModes.get(paneKey)?.has(mode)).map(({ mode, icon }) => ({
        id: `mode-${mode ?? "default"}`, label: modeWord(t, mode), icon, current: mode === current,
        run: () => void pick(mode),
      }))} />}
    {note !== null && <span className="composer-mode-note" role="status">{note}</span>}
  </>;
}
