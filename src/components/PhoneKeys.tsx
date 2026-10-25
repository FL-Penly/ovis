/**
 * Downstream (FL-Penly/ovis, DOWNSTREAM.md): the terminal keys on a touch screen, laid out as
 * mobile-terminal's toolbar. Three rows (folded to one on request, kept per browser): Esc ^C ^L and
 * the input line and Paste keys; Tab ⇧Tab Enter ⇧Enter and ↑; the combo panel's key and ← ↓ →.
 * The combo panel takes their place: Ctrl, Alt and Shift latched until pressed again, a navigation
 * grid, and pages of letters and digits, symbols, and editing and function keys. Every key is a
 * key bar item for PaneTerminal's pressKey, so herdr encodes it (lib/phoneKeys.ts).
 */
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp, ClipboardPaste, Keyboard } from "lucide-react";

import "./KeyBar.css";
import "./PhoneKeys.css";

import { ARROWS, Chevron, Key, KEY_SPOKEN_NAMES } from "./KeyBar.tsx";
import { keyBarItemLabel, type KeyBarKeyItem } from "../lib/keyBar.ts";
import { isRepeatableKeyBarItem } from "../lib/keyRepeat.ts";
import type { StickyModifiers } from "../lib/keys.ts";
import { comboItem, FUNCTION_KEYS, LETTERS, NAVIGATION, NONE, SYMBOLS } from "../lib/phoneKeys.ts";
import { useT } from "../lib/i18n.ts";

const EXPANDED_KEY = "ovis-downstream:phone-keys-expanded";
type Page = "letters" | "symbols" | "functions";

export interface PhoneKeysProps {
  disabled?: boolean;
  holdScope?: string;
  onKey: (item: KeyBarKeyItem) => void;
  directTyping?: boolean;
  onToggleDirect?: () => void;
  directDisabled?: boolean;
  onPaste?: () => void;
  pasteDisabled?: boolean;
  note?: string | null;
  onNoteDismiss?: () => void;
}

const storedExpanded = (): boolean => { try { return localStorage.getItem(EXPANDED_KEY) !== "0"; } catch { return true; } };

export function PhoneKeys({ disabled, holdScope, onKey, directTyping, onToggleDirect, directDisabled, onPaste, pasteDisabled, note, onNoteDismiss }: PhoneKeysProps) {
  const t = useT();
  const [expanded, setExpanded] = useState(storedExpanded);
  const [panel, setPanel] = useState(false);
  const [page, setPage] = useState<Page>("letters");
  const [latched, setLatched] = useState<StickyModifiers>(NONE);
  const barRef = useRef<HTMLDivElement | null>(null);
  // as KeyBar's: only keys that reach the bottom of the screen keep clear of the home indicator
  useLayoutEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    const place = (): void => {
      bar.classList.remove("is-at-screen-bottom");
      bar.classList.toggle("is-at-screen-bottom", bar.getBoundingClientRect().bottom >= window.innerHeight - 1);
    };
    place();
    const observer = new ResizeObserver(place);
    for (let node: HTMLElement | null = bar; node; node = node.parentElement) observer.observe(node);
    window.addEventListener("resize", place);
    return () => { observer.disconnect(); window.removeEventListener("resize", place); };
  }, []);

  const fold = (next: boolean): void => {
    setExpanded(next);
    try { localStorage.setItem(EXPANDED_KEY, next ? "1" : "0"); } catch { /* storage denied: kept for this page */ }
  };
  const closePanel = (): void => { setPanel(false); setLatched(NONE); };

  const spoken = (key: string): string | undefined => {
    const name = ARROWS.find((arrow) => arrow.key === key)?.label ?? KEY_SPOKEN_NAMES.find((entry) => entry.key === key)?.label;
    return name === undefined ? undefined : t(name);
  };
  const key = (item: KeyBarKeyItem, cap?: ReactNode, label?: string): ReactNode => {
    const arrow = item.modifiers === undefined || (!item.modifiers.ctrl && !item.modifiers.alt && !item.modifiers.shift)
      ? ARROWS.find((candidate) => candidate.key === item.key) : undefined;
    return <Key key={`${item.key}:${JSON.stringify(item.modifiers ?? null)}`} disabled={disabled} dataKey={item.key} label={label ?? spoken(item.key)}
      onPress={() => onKey(item)} repeatable={isRepeatableKeyBarItem(item)} holdScope={holdScope}>
      {cap ?? (arrow ? <Chevron direction={arrow.direction} /> : keyBarItemLabel({ type: "key", key: item.key }))}
    </Key>;
  };
  const named = (name: string): KeyBarKeyItem => ({ type: "key", key: name });
  const ctrlL: KeyBarKeyItem = { type: "key", key: "l", modifiers: { ctrl: true, alt: false, shift: false } };
  const shiftEnter: KeyBarKeyItem = { type: "key", key: "Enter", modifiers: { ctrl: false, alt: false, shift: true } };
  const comboKey = <Key key="combo" disabled={disabled} dataKey="combo" pressed={panel} onPress={() => (panel ? closePanel() : setPanel(true))}>{t("Combo keys")}</Key>;
  const modeKeys = <>
    {onToggleDirect && <Key key="direct" disabled={disabled || directDisabled} dataKey="direct" label={t("Input line")} pressed={!directTyping} onPress={onToggleDirect}><Keyboard aria-hidden="true" /></Key>}
    {onPaste && <Key key="paste" disabled={disabled || pasteDisabled} dataKey="paste" label={t("Paste into the line")} onPress={onPaste}><ClipboardPaste aria-hidden="true" /></Key>}
  </>;
  const noteRow = note ? <p className="key-bar-note" role="status" onClick={onNoteDismiss}>{note}</p> : null;

  let body: ReactNode;
  if (panel) {
    const toggle = (modifier: keyof StickyModifiers): void => setLatched((before) => ({ ...before, [modifier]: !before[modifier] }));
    const pageKeys = page === "letters" ? [...LETTERS, " "] : page === "symbols" ? SYMBOLS : FUNCTION_KEYS;
    body = <div className="phone-keys-panel">
      <div className="phone-keys-row">
        {(["ctrl", "alt", "shift"] as const).map((modifier) => <Key key={modifier} disabled={disabled} dataKey={modifier} pressed={latched[modifier]} onPress={() => toggle(modifier)}>
          {{ ctrl: "Ctrl", alt: "Alt", shift: "Shift" }[modifier]}
        </Key>)}
        <span className="phone-keys-spacer" />
        <Key key="back" disabled={disabled} dataKey="back" onPress={closePanel}>{t("Back")}</Key>
      </div>
      <p className="phone-keys-hint">{t("Ctrl, Alt and Shift stay on until pressed again")}</p>
      <div className="phone-keys-grid is-navigation">{NAVIGATION.map((name) => key(comboItem(name, latched)))}</div>
      <div className="phone-keys-tabs" role="tablist">
        {([["letters", t("Letters & digits")], ["symbols", t("Symbol keys")], ["functions", t("Function keys")]] as const).map(([id, word]) =>
          <button key={id} type="button" role="tab" aria-selected={page === id} className={`phone-keys-tab${page === id ? " is-active" : ""}`}
            onPointerDown={(event) => event.preventDefault()} onClick={() => setPage(id)}>{word}</button>)}
      </div>
      <div className={`phone-keys-grid is-${page}`}>{pageKeys.map((name) => key(comboItem(name, latched), name === " " ? t("Space") : undefined, name === " " ? t("Space") : undefined))}</div>
    </div>;
  } else if (expanded) {
    body = <>
      <div className="phone-keys-row is-scroll">
        <Key key="fold" disabled={false} dataKey="fold" label={t("Fold the keys to one row")} onPress={() => fold(false)}><ChevronDown aria-hidden="true" /></Key>
        {noteRow ?? <>{key(named("Escape"))}{key(named("ctrl-c"))}{key(ctrlL, "^L", t("Control L"))}</>}
        <span className="phone-keys-gap" />
        {modeKeys}
      </div>
      <div className="phone-keys-row">
        {key(named("Tab"))}{key(named("BackTab"))}{key(named("Enter"))}{key(shiftEnter, "⇧Enter", t("Shift Enter"))}
        <span className="phone-keys-spacer" />
        {key(named("ArrowUp"))}
      </div>
      <div className="phone-keys-row">
        {comboKey}
        <span className="phone-keys-spacer" />
        {key(named("ArrowLeft"))}{key(named("ArrowDown"))}{key(named("ArrowRight"))}
      </div>
    </>;
  } else {
    body = <div className="phone-keys-row is-scroll">
      <Key key="unfold" disabled={false} dataKey="unfold" label={t("Unfold the keys")} onPress={() => fold(true)}><ChevronUp aria-hidden="true" /></Key>
      {noteRow ?? <>
        {key(named("Escape"))}{key(named("Tab"))}{key(named("BackTab"))}{key(shiftEnter, "⇧Enter", t("Shift Enter"))}{key(named("ctrl-c"))}
        {key(named("ArrowUp"))}{key(named("ArrowDown"))}{key(named("ArrowLeft"))}{key(named("ArrowRight"))}{comboKey}
      </>}
      <span className="phone-keys-gap" />
      {modeKeys}
    </div>;
  }

  return <div className={`key-bar phone-keys${panel ? " is-panel" : ""}`} ref={barRef} role="group" aria-label={t("Phone terminal keys")}>{body}</div>;
}
