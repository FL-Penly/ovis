/**
 * Downstream (FL-Penly/ovis, DOWNSTREAM.md): `GET /api/pane/long-run`, the Claude Code panes of this
 * PC that run with an auto-compact window of their own, read from each process's environment, so a
 * session started by hand with the variable counts too. Linux only (`/proc`); elsewhere none.
 */
import { compactWindow, LONG_RUN_ENV } from "../shared/long-run.ts";
import type { HerdrPane } from "../shared/protocol.ts";
import { claudePanePid } from "./conversation.ts";
import { sessionSnapshot } from "./herdr/client.ts";
import { badRequest, errorResponse, jsonResponse, setRequestRoute } from "./http.ts";
import { processEnviron } from "./omo.ts";

export interface LongRunSources {
  panes: () => Promise<readonly HerdrPane[]>;
  pid: (pane: HerdrPane) => Promise<number | null>;
  environ: (pid: number) => readonly string[] | null;
}

const DEFAULT_SOURCES: LongRunSources = {
  panes: async () => (await sessionSnapshot()).panes,
  pid: claudePanePid,
  environ: processEnviron,
};

// a process's environment never changes: one read per pid
const seen = new Map<number, number | null>();

/** pane id → its window, for each Claude pane that sets one. */
export async function longRunPanes(sources: LongRunSources = DEFAULT_SOURCES, cache: Map<number, number | null> = seen): Promise<Record<string, number>> {
  const claude = (await sources.panes()).filter((pane) => pane.agent === "claude");
  const found: Record<string, number> = {};
  await Promise.all(claude.map(async (pane) => {
    const pid = await sources.pid(pane).catch(() => null);
    if (pid === null) return;
    if (!cache.has(pid)) {
      const environ = sources.environ(pid);
      // unreadable now (a process still starting): asked again next time
      if (environ === null) return;
      cache.set(pid, compactWindow(environ.find((word) => word.startsWith(`${LONG_RUN_ENV}=`))?.slice(LONG_RUN_ENV.length + 1)));
      if (cache.size > 512) cache.delete(cache.keys().next().value!);
    }
    const size = cache.get(pid);
    if (size) found[pane.pane_id] = size;
  }));
  return found;
}

export async function handleLongRunRequest(request: Request, pathname: string): Promise<Response> {
  setRequestRoute(pathname);
  if (request.method !== "GET") return badRequest("method_not_allowed", "use GET");
  try {
    return jsonResponse({ panes: await longRunPanes() });
  } catch (error) {
    return errorResponse(error);
  }
}
