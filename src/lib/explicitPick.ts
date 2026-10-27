/**
 * Downstream (FL-Penly/ovis, DOWNSTREAM.md): a finish picked by hand is read once its pane shows.
 *
 * Upstream reads a finish only when the chat stands at its end and the transcript ends in a final
 * answer (panePresentation.ts), so an automatic selection never reads an answer nobody saw. A press
 * on a sidebar row is no such guess: it says the user looked. Then the finish showing at the press
 * is read once the pane's content is drawn for it (ChatView's `data-pane-shown`, or the terminal's
 * own `data-pane-content`) on a visible page with nothing over it, wherever the chat is scrolled and
 * whatever its last turn. A later finish is read as upstream reads it.
 */
import type { HerdrPane } from "../../shared/protocol.ts";
import { paneCovered } from "./panePresentation.ts";

interface HandPick { machineId: string; paneId: string; epoch: string; finishId: number; until: number }

const PICK_MS = 30_000;

let pick: HandPick | null = null;
let version = 0;
let observer: MutationObserver | null = null;
let ready = false;
let expiry: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

function bump(): void {
  version++;
  for (const listener of listeners) listener();
}

function stopWatching(): void {
  observer?.disconnect();
  observer = null;
  clearTimeout(expiry);
  expiry = undefined;
}

export const subscribePick = (listener: () => void): (() => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const pickVersion = (): number => version;

/** A press on `pane`'s row: its finish, if it shows one, is read once the pane is drawn for it. */
export function notePick(machineId: string, pane: Pick<HerdrPane, "pane_id" | "agent_status" | "finish_id" | "background_wait">, epoch: string | undefined): void {
  stopWatching();
  pick = null;
  if (epoch && pane.agent_status === "done" && !pane.background_wait && pane.finish_id !== undefined && pane.finish_id > 0) {
    pick = { machineId, paneId: pane.pane_id, epoch, finishId: pane.finish_id, until: Date.now() + PICK_MS };
    // the content comes after the press: the page is asked again on each change, and a reader told only once it shows
    if (typeof MutationObserver !== "undefined" && typeof document !== "undefined") {
      ready = shows(pick);
      observer = new MutationObserver(() => {
        const now = pick !== null && shows(pick);
        if (now && !ready) bump();
        ready = now;
      });
      observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-pane-shown", "data-pane-content", "role", "open", "hidden", "class"] });
    }
    expiry = setTimeout(() => { stopWatching(); pick = null; bump(); }, PICK_MS);
  }
  bump();
}

/** The marker's key as paneContentKey writes it: PC, pane, terminal, view, finish epoch, finish ID. */
function drawnFor(machineId: string, paneId: string, epoch: string, finishId: number): boolean {
  return [...document.querySelectorAll("[data-pane-shown],[data-pane-content]")].some((node) => {
    if (node.querySelector("[data-pane-content-error]")) return false;
    for (const name of ["data-pane-shown", "data-pane-content"]) {
      try {
        const key: unknown = JSON.parse(node.getAttribute(name) ?? "null");
        if (Array.isArray(key) && key[0] === machineId && key[1] === paneId && key[4] === epoch && key[5] === finishId) return true;
      } catch { /* not a key */ }
    }
    return false;
  });
}

const shows = (picked: HandPick): boolean => !paneCovered() && drawnFor(picked.machineId, picked.paneId, picked.epoch, picked.finishId);

/** Whether `pane`'s finish was picked by hand and its content is drawn for it, uncovered. Read once. */
export function pickShown(machineId: string, pane: Pick<HerdrPane, "pane_id" | "finish_id">, epoch: string): boolean {
  const picked = pick;
  if (!picked || Date.now() > picked.until || picked.machineId !== machineId || picked.paneId !== pane.pane_id
    || picked.epoch !== epoch || picked.finishId !== pane.finish_id) return false;
  if (!shows(picked)) return false;
  stopWatching();
  pick = null;
  return true;
}
