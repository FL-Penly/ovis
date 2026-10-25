/**
 * Downstream (FL-Penly/ovis, DOWNSTREAM.md): over the terminal's input line on a touch screen, as in
 * mobile-terminal: the last lines sent (a pick puts one back in the line) and saved phrases (a tap
 * adds one to the line; ☆ saves the line as one; ✎ shows each phrase's ✕). Kept per browser.
 */
import { useState, useSyncExternalStore, type PointerEvent } from "react";
import { History, Pencil, Star, X } from "lucide-react";

import "./LineExtras.css";

import { readHistory, readPhrases, removePhrase, savePhrase } from "../lib/phoneKeys.ts";
import { readTerminalDraft, subscribeTerminalDraft, writeTerminalDraft } from "../lib/terminalDraft.ts";
import { useT } from "../lib/i18n.ts";

// the line's keyboard stays up: a tap here never takes the focus from it
const keepFocus = (event: PointerEvent<HTMLElement>): void => event.preventDefault();

export function LineExtras({ owner }: { owner: string }) {
  const t = useT();
  const line = useSyncExternalStore(subscribeTerminalDraft, () => readTerminalDraft(owner));
  const [phrases, setPhrases] = useState(readPhrases);
  const [history, setHistory] = useState<string[] | null>(null);
  const [editing, setEditing] = useState(false);
  const add = (phrase: string): void => {
    const current = readTerminalDraft(owner);
    writeTerminalDraft(owner, current === "" || /\s$/.test(current) ? current + phrase : `${current} ${phrase}`);
  };
  return <div className="line-extras">
    <div className="line-extras-row">
      <button type="button" className="line-extras-tool" aria-label={t("Recent lines")} title={t("Recent lines")} aria-expanded={history !== null}
        onPointerDown={keepFocus} onClick={() => setHistory((open) => open === null ? readHistory() : null)}><History aria-hidden="true" /></button>
      <div className="line-extras-phrases">
        {phrases.length === 0 && <span className="line-extras-empty">{t("☆ saves the line as a phrase")}</span>}
        {phrases.map((phrase) => <span key={phrase} className="line-extras-chip">
          <button type="button" className="line-extras-chip-text" title={phrase} onPointerDown={keepFocus} onClick={() => add(phrase)}>{phrase}</button>
          {editing && <button type="button" className="line-extras-chip-remove" aria-label={t("Remove {phrase}", { phrase })}
            onPointerDown={keepFocus} onClick={() => setPhrases(removePhrase(phrase))}><X aria-hidden="true" /></button>}
        </span>)}
      </div>
      <button type="button" className="line-extras-tool" aria-label={t("Save the line as a phrase")} title={t("Save the line as a phrase")} disabled={line.trim() === ""}
        onPointerDown={keepFocus} onClick={() => setPhrases(savePhrase(line))}><Star aria-hidden="true" /></button>
      <button type="button" className="line-extras-tool" aria-label={t("Edit phrases")} title={t("Edit phrases")} aria-pressed={editing} disabled={phrases.length === 0 && !editing}
        onPointerDown={keepFocus} onClick={() => setEditing((on) => !on)}><Pencil aria-hidden="true" /></button>
    </div>
    {history !== null && <ul className="line-extras-history" aria-label={t("Recent lines")}>
      {history.length === 0 && <li className="line-extras-empty">{t("Nothing sent from the input line yet")}</li>}
      {history.map((entry) => <li key={entry}><button type="button" onPointerDown={keepFocus} onClick={() => { writeTerminalDraft(owner, entry); setHistory(null); }}>{entry}</button></li>)}
    </ul>}
  </div>;
}
