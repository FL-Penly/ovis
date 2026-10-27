/**
 * Downstream (FL-Penly/ovis, DOWNSTREAM.md): the Claude Code and Codex panes of this PC whose /goal is
 * not met yet (server/goal-status.ts), for the sidebar's `goal` mark. A goal ends on its own, so it is
 * asked again now and then, and at once when one of these panes changes state: a turn that ends is when
 * a goal is judged.
 */
import { useEffect, useState } from "react";

export interface OpenGoal {
  objective: string;
  since: number | null;
  paused: string | null;
  tokens?: number;
  seconds?: number;
}

const AGAIN_MS = 15_000;

const askGoals = (): Promise<Record<string, OpenGoal> | null> => fetch("/api/pane/goals")
  .then((response) => response.ok ? response.json() as Promise<{ panes?: Record<string, OpenGoal> }> : null)
  .then((body) => body?.panes ?? null, () => null);

/** `panes` keys each agent pane with its state: a change asks at once. */
export function useOpenGoals(machineId: string, panes: readonly string[]): Readonly<Record<string, OpenGoal>> {
  const [found, setFound] = useState<Record<string, OpenGoal>>({});
  const key = machineId === "local" ? [...panes].sort().join(" ") : "";
  const asks = key !== "";
  useEffect(() => {
    if (!asks) { setFound({}); return; }
    let live = true;
    const timer = setInterval(() => void askGoals().then((goals) => { if (live && goals) setFound(goals); }), AGAIN_MS);
    return () => { live = false; clearInterval(timer); };
  }, [asks]);
  useEffect(() => {
    if (!asks) return;
    let live = true;
    void askGoals().then((goals) => { if (live && goals) setFound(goals); });
    return () => { live = false; };
  }, [key]);
  return found;
}
