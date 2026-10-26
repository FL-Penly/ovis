/**
 * Downstream (FL-Penly/ovis, DOWNSTREAM.md): on a touch screen a tap on the grid no longer raises the
 * soft keyboard, as in mobile-terminal: xterm's textarea is `inputmode="none"`, the keys and the
 * input line do the typing, and a double tap on the grid raises the keyboard or puts it away.
 */
import { useEffect, type RefObject } from "react";
import type { Terminal } from "@xterm/xterm";

const DOUBLE_TAP_MS = 350;
const TAP_SLOP_PX = 12;
const SECOND_TAP_SLOP_PX = 32;

/** `focusMoveRef` is upstream's keyboard control flag: held while the tap moves the focus, so xterm's
 * focus report (`ESC [ I` / `ESC [ O`) of that move is not sent as input (useTerminalMount.ts). */
export function useDoubleTapKeyboard(terminal: Terminal | null, hostRef: RefObject<HTMLElement | null>, enabled: boolean, windowMs = DOUBLE_TAP_MS, focusMoveRef?: RefObject<boolean>): void {
  useEffect(() => {
    const textarea = terminal?.textarea;
    const host = hostRef.current;
    if (!enabled || !textarea || !host) return;
    const before = textarea.getAttribute("inputmode");
    textarea.setAttribute("inputmode", "none");
    let start: { x: number; y: number } | null = null;
    let last: { at: number; x: number; y: number } | null = null;
    const onTouchStart = (event: TouchEvent): void => {
      const touch = event.touches[0];
      start = event.touches.length === 1 && touch ? { x: touch.clientX, y: touch.clientY } : null;
    };
    const onTouchEnd = (event: TouchEvent): void => {
      const touch = event.changedTouches[0];
      if (!start || !touch || event.touches.length > 0 || Math.hypot(touch.clientX - start.x, touch.clientY - start.y) > TAP_SLOP_PX) { last = null; return; }
      const tap = { at: event.timeStamp, x: touch.clientX, y: touch.clientY };
      if (last && tap.at - last.at < windowMs && Math.hypot(tap.x - last.x, tap.y - last.y) < SECOND_TAP_SLOP_PX) {
        last = null;
        const typing = textarea.getAttribute("inputmode") !== "none";
        // the keyboard follows inputmode on the next focus, so the textarea is focused again; the
        // blur comes first, as its handler below puts inputmode back to none
        if (focusMoveRef) focusMoveRef.current = true;
        try {
          textarea.blur();
          textarea.setAttribute("inputmode", typing ? "none" : "text");
          if (!typing) textarea.focus();
        } finally {
          if (focusMoveRef) focusMoveRef.current = false;
        }
        return;
      }
      last = tap;
    };
    // a keyboard put away with the textarea's focus gone is away for the next single tap too
    const onBlur = (): void => textarea.setAttribute("inputmode", "none");
    host.addEventListener("touchstart", onTouchStart, { passive: true });
    host.addEventListener("touchend", onTouchEnd, { passive: true });
    textarea.addEventListener("blur", onBlur);
    return () => {
      host.removeEventListener("touchstart", onTouchStart);
      host.removeEventListener("touchend", onTouchEnd);
      textarea.removeEventListener("blur", onBlur);
      if (before === null) textarea.removeAttribute("inputmode"); else textarea.setAttribute("inputmode", before);
    };
  }, [terminal, hostRef, enabled, windowMs, focusMoveRef]);
}
