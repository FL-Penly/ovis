/**
 * Downstream (FL-Penly/ovis, DOWNSTREAM.md): the Claude panes of this PC that run with a compact window
 * of their own (server/long-run.ts), asked again whenever the set of Claude panes changes.
 */
import { useEffect, useState } from "react";

export function useLongRunPanes(machineId: string, claudePanes: readonly string[]): Readonly<Record<string, number>> {
  const [found, setFound] = useState<Record<string, number>>({});
  const key = machineId === "local" ? [...claudePanes].sort().join(" ") : "";
  useEffect(() => {
    if (key === "") { setFound({}); return; }
    let live = true;
    // a process found a moment after its pane may not have its environment readable yet: once more later
    const ask = () => fetch("/api/pane/long-run").then((response) => response.ok ? response.json() as Promise<{ panes?: Record<string, number> }> : null)
      .then((body) => { if (live && body?.panes) setFound(body.panes); }, () => undefined);
    void ask();
    const again = setTimeout(ask, 5_000);
    return () => { live = false; clearTimeout(again); };
  }, [key]);
  return found;
}
