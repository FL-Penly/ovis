// @ts-check
/**
 * Downstream (FL-Penly/ovis, DOWNSTREAM.md): the Source Control panel's requests
 * (server/git-panel-routes.ts) and its commit graph's layout.
 */
import type { GitBranch, GitCommit, GitDone, GitLog, GitStatus } from "../../shared/git-panel.ts";

export class GitRequestError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

async function answer<T>(response: Response): Promise<T> {
  if (response.ok) return await response.json() as T;
  const body = await response.json().catch(() => null) as { error?: { code?: string; message?: string } } | null;
  throw new GitRequestError(body?.error?.code ?? `http_${response.status}`, body?.error?.message ?? `HTTP ${response.status}`);
}

const query = (paneId: string, extra: Record<string, string> = {}) => new URLSearchParams({ pane_id: paneId, ...extra }).toString();

export const gitApi = {
  status: async (paneId: string): Promise<GitStatus> => answer(await fetch(`/api/pane/git/status?${query(paneId)}`)),
  log: async (paneId: string, limit: number, skip: number): Promise<GitLog> =>
    answer(await fetch(`/api/pane/git/log?${query(paneId, { limit: String(limit), skip: String(skip) })}`)),
  branches: async (paneId: string): Promise<GitBranch[]> => answer(await fetch(`/api/pane/git/branches?${query(paneId)}`)),
  run: async (op: "stage" | "unstage" | "discard" | "commit" | "push" | "pull" | "fetch" | "checkout", paneId: string, body: Record<string, unknown> = {}): Promise<GitDone> =>
    answer(await fetch(`/api/pane/git/${op}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-herdr-machine": "1" },
      body: JSON.stringify({ pane_id: paneId, ...body }),
    })),
};

/** How one row of the graph is drawn: the commit's lane, the lanes passing it, and the edges into and out of it. */
export interface GraphRow {
  commit: GitCommit;
  lane: number;
  /** lanes running down through the top half: [from lane, to lane] (to = the commit's own lane for an edge that ends here) */
  top: [number, number][];
  /** lanes running down through the bottom half: [from lane, to lane] (from = the commit's lane for an edge that leaves it) */
  bottom: [number, number][];
  /** lanes in use at this row, for the graph's width */
  width: number;
}

/**
 * Lanes for commits in topological order, newest first, as VS Code's Git Graph draws them: each
 * lane waits for one commit; a commit takes the lane waiting for it (lanes of children that merge
 * into it end there), its first parent goes on in that lane and each other parent takes the lane
 * already waiting for it or a free one. Lanes never move sideways, so a lane is a straight line.
 */
export function layoutGraph(commits: readonly GitCommit[]): GraphRow[] {
  const lanes: (string | null)[] = [];
  const rows: GraphRow[] = [];
  for (const commit of commits) {
    const waiting = lanes.flatMap((hash, lane) => hash === commit.hash ? [lane] : []);
    let lane = waiting[0] ?? lanes.indexOf(null);
    if (lane < 0) lane = lanes.length;
    const top: [number, number][] = [];
    lanes.forEach((hash, at) => { if (hash !== null) top.push([at, hash === commit.hash ? lane : at]); });
    for (const at of waiting) lanes[at] = null;
    const bottom: [number, number][] = [];
    const [first, ...others] = commit.parents;
    lanes[lane] = first ?? null;
    if (first !== undefined) bottom.push([lane, lane]);
    for (const parent of others) {
      let target = lanes.indexOf(parent);
      if (target < 0) {
        target = lanes.indexOf(null);
        if (target < 0) target = lanes.length;
        lanes[target] = parent;
      }
      bottom.push([lane, target]);
    }
    lanes.forEach((hash, at) => { if (hash !== null && at !== lane && !bottom.some(([, to]) => to === at)) bottom.push([at, at]); });
    while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop();
    rows.push({ commit, lane, top, bottom, width: Math.max(lane + 1, lanes.length, ...top.map(([from]) => from + 1)) });
  }
  return rows;
}

/** A file path as the list shows it: its name, and the folder it sits in. */
export function splitPath(path: string): { name: string; folder: string } {
  const at = path.lastIndexOf("/");
  return at < 0 ? { name: path, folder: "" } : { name: path.slice(at + 1), folder: path.slice(0, at) };
}
