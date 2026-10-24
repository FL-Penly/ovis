/**
 * Downstream (FL-Penly/ovis, DOWNSTREAM.md): herdr-web's sticky prompt. While the reader is inside
 * an answer whose prompt has scrolled out of view, that prompt stays pinned over the top of the
 * chat, cut to two lines; a press goes back to it. It reads what the minimap reads (ChatMinimap):
 * the user's turns by timeline row, and which rows are on screen.
 */
import { useEffect, useState, type CSSProperties, type RefObject } from "react";
import type { MinimapTurn } from "../lib/chatMinimap.ts";
import { useT } from "../lib/i18n.ts";
import "./StickyPrompt.css";

/** The turn whose answer the top of the view is in, while its own row is above the view; else null. */
export function stickyTurn(turnRows: readonly number[], firstVisible: number): number | null {
  let shown: number | null = null;
  for (const [index, row] of turnRows.entries()) {
    if (row > firstVisible) break;
    shown = row < firstVisible ? index : null;
  }
  return shown;
}

export function StickyPrompt({ turns, rowKeys, scroller, onJump }: { turns: readonly MinimapTurn[]; rowKeys: readonly string[]; scroller: RefObject<HTMLDivElement | null>; onJump(row: number): void }) {
  const t = useT();
  const [shown, setShown] = useState<{ turn: number; style: CSSProperties } | null>(null);

  useEffect(() => {
    const node = scroller.current;
    if (node === null) return;
    const positions = new Map(rowKeys.map((key, index) => [key, index]));
    const turnRows = turns.map((turn) => turn.row);
    let frame = 0;
    const measure = (): void => {
      frame = 0;
      const view = node.getBoundingClientRect();
      // the first row still showing under the view's top edge (a few pixels of a row's end do not count)
      let first = Infinity;
      for (const row of node.querySelectorAll<HTMLElement>("[data-chat-row]")) {
        const box = row.getBoundingClientRect();
        const index = positions.get(row.dataset.chatRow ?? "");
        if (index === undefined || box.bottom <= view.top + 8 || box.top >= view.bottom) continue;
        first = Math.min(first, index);
      }
      const turn = Number.isFinite(first) ? stickyTurn(turnRows, first) : null;
      if (turn === null || !turns[turn]?.preview) { setShown((previous) => previous === null ? previous : null); return; }
      // over the chat's column, as wide as its messages
      const column = node.querySelector<HTMLElement>(".chat-transcript")?.getBoundingClientRect();
      const frameBox = node.parentElement?.getBoundingClientRect() ?? view;
      const style: CSSProperties = column ? { left: column.left - frameBox.left, width: column.width } : {};
      setShown((previous) => previous?.turn === turn && previous.style.left === style.left && previous.style.width === style.width ? previous : { turn, style });
    };
    const schedule = (): void => { if (frame === 0) frame = requestAnimationFrame(measure); };
    schedule();
    node.addEventListener("scroll", schedule, { passive: true });
    const observer = new ResizeObserver(schedule);
    observer.observe(node);
    return () => {
      cancelAnimationFrame(frame);
      node.removeEventListener("scroll", schedule);
      observer.disconnect();
    };
  }, [scroller, rowKeys, turns]);

  const turn = shown === null ? undefined : turns[shown.turn];
  if (shown === null || turn === undefined) return null;
  return <button type="button" className="sticky-prompt" style={shown.style} title={t("Back to this message")} onClick={() => onJump(turn.row)}>
    {turn.preview}
  </button>;
}
