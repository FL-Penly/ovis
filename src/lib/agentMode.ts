/**
 * Downstream (FL-Penly/ovis, DOWNSTREAM.md): the mode Claude Code or Codex shows under its input box,
 * read from the pane's visible screen, for the composer's mode chip (components/ModeChip.tsx). Ported
 * from herdr-web's src/tui/status.ts and screen.ts, with their screen fixtures.
 *
 * Only the input box's own chrome is read (Claude: its top rule and the footer under it; Codex: the
 * footer under its `›` row, and the session header for YOLO), so transcript text that merely mentions
 * a mode cannot change it. While a dialog, menu or panel replaces the input box, Shift+Tab means
 * something else there, so `inputBox` is false and the chip does not send it.
 */
export interface AgentModeReading {
  inputBox: boolean;
  /** null: the default mode, or no input box to read it from */
  mode: AgentMode | null;
}

export type AgentMode = "bypass permissions" | "plan mode" | "accept edits" | "auto mode" | "manual mode" | "YOLO mode";

const RULE_RE = /^\s*[╭┌]?[─━▔]{8,}/;
/** a numbered option row, which a cursor glyph may point at: a menu, never the input box */
const OPTION_RE = /^\s*[❯›▶]?\s*(\d{1,2})[.)]\s+(.+?)\s*$/;
/** `\s` also takes the NBSP Claude Code prints after `❯` */
const CURSOR_RE = /^\s*[❯›](\s|$)/;
const MENU_HINT_RE = /(enter (to )?(select|confirm|submit|continue|resume)|esc (to )?(back|cancel|exit))/i;
const INPUT_SCAN_ROWS = 30;

const MODES: [RegExp, AgentMode][] = [
  [/bypass permissions on/i, "bypass permissions"],
  [/plan mode on|Plan mode(?= \(shift\+tab)/i, "plan mode"],
  [/accept edits on/i, "accept edits"],
  [/auto mode on/i, "auto mode"],
  [/manual mode on/i, "manual mode"],
  [/YOLO mode/i, "YOLO mode"],
];
/** Codex prints its approval mode only in the session header box at the top */
const CODEX_HEADER_MODE_RE = /^[\s│]*permissions:\s+YOLO mode[\s│]*$/m;

const isRule = (row: string): boolean => RULE_RE.test(row);
const isCursorRow = (row: string): boolean => CURSOR_RE.test(row) && !OPTION_RE.test(row);
const isCodexFooterRow = (row: string): boolean => /·|for shortcuts|\(shift\+tab/.test(row) && !MENU_HINT_RE.test(row);
const isCodexContinuation = (row: string): boolean => !!row.trim() && /^\s{2}/.test(row) && !isRule(row) && !isCodexFooterRow(row);

interface InputBox { end: number; topRule: number }

/** Claude Code: a rule, `❯` and the text, a rule, then the footer. Codex: `›` and the text, a blank row, a footer with `·`. */
function findInputBox(rows: string[]): InputBox | null {
  for (let i = rows.length - 1; i >= Math.max(0, rows.length - INPUT_SCAN_ROWS); i--) {
    const row = rows[i] ?? "";
    if (!isCursorRow(row)) continue;
    if (row.trimStart().startsWith("❯")) {
      if (!isRule(rows[i - 1] ?? "")) continue;
      let bottom = i + 1;
      while (bottom < rows.length && !isRule(rows[bottom] ?? "")) bottom++;
      if (bottom >= rows.length) continue;
      return { end: bottom, topRule: i - 1 };
    }
    let last = i;
    while (last + 1 < rows.length && isCodexContinuation(rows[last + 1] ?? "")) last++;
    if (!rows.slice(last + 1, last + 4).some(isCodexFooterRow)) continue;
    return { end: last, topRule: -1 };
  }
  return null;
}

export function readAgentMode(screen: string): AgentModeReading {
  const rows = screen.split("\n").map((row) => row.replace(/\s+$/, ""));
  const box = findInputBox(rows);
  if (box === null) return { inputBox: false, mode: null };
  const chrome = [box.topRule >= 0 ? rows[box.topRule] ?? "" : "", ...rows.slice(box.end + 1)].join("\n");
  const mode = MODES.find(([pattern]) => pattern.test(chrome))?.[1] ?? (CODEX_HEADER_MODE_RE.test(screen) ? "YOLO mode" : null);
  return { inputBox: true, mode };
}
