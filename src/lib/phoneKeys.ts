/**
 * Downstream (FL-Penly/ovis, DOWNSTREAM.md): what the phone keys (components/PhoneKeys.tsx) send, and
 * the input line's recent lines and phrases. Every key goes as a key bar item with exact modifiers,
 * so herdr encodes it in the pane's own keyboard protocol (lib/useTypedKeys.ts).
 */
import { hasModifiers, type StickyModifiers } from "./keys.ts";
import type { KeyBarKeyItem } from "./keyBar.ts";

export const NONE: StickyModifiers = { ctrl: false, alt: false, shift: false };

export const LETTERS = [..."1234567890qwertyuiopasdfghjklzxcvbnm"];
export const SYMBOLS = [..."`~!@#$%^&*()-_=+[]{}\\|;:'\",.<>/?"];
export const FUNCTION_KEYS = ["Home", "End", "PageUp", "PageDown", "Insert", "Delete", "F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12"];
export const NAVIGATION = ["Escape", "Tab", "Enter", "Backspace", "ArrowLeft", "ArrowDown", "ArrowUp", "ArrowRight"];

/**
 * A combo panel key under the panel's latched modifiers. Shift alone on a letter is the capital
 * letter itself, as a keyboard types it, rather than a chord the program may read differently.
 */
export function comboItem(key: string, modifiers: StickyModifiers): KeyBarKeyItem {
  if (modifiers.shift && !modifiers.ctrl && !modifiers.alt && /^[a-z]$/.test(key)) return { type: "key", key: key.toUpperCase(), modifiers: NONE };
  return { type: "key", key, modifiers: hasModifiers(modifiers) ? { ...modifiers } : NONE };
}

const HISTORY_KEY = "ovis-downstream:line-history";
const PHRASES_KEY = "ovis-downstream:line-phrases";
export const HISTORY_LIMIT = 10;

function readList(key: string): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim() !== "") : [];
  } catch { return []; }
}
function writeList(key: string, list: readonly string[]): void {
  try { localStorage.setItem(key, JSON.stringify(list)); } catch { /* storage denied: kept for this page */ }
}

/** The lines sent from the input line, newest first, each once. */
export const readHistory = (): string[] => readList(HISTORY_KEY);
export function rememberLine(text: string): string[] {
  const line = text.trim();
  if (line === "") return readHistory();
  const next = [line, ...readHistory().filter((item) => item !== line)].slice(0, HISTORY_LIMIT);
  writeList(HISTORY_KEY, next);
  return next;
}

/** The phrases kept for the input line, in the order they were saved. */
export const readPhrases = (): string[] => readList(PHRASES_KEY);
export function savePhrase(text: string): string[] {
  const phrase = text.trim();
  const list = readPhrases();
  if (phrase === "" || list.includes(phrase)) return list;
  const next = [...list, phrase];
  writeList(PHRASES_KEY, next);
  return next;
}
export function removePhrase(text: string): string[] {
  const next = readPhrases().filter((item) => item !== text);
  writeList(PHRASES_KEY, next);
  return next;
}
