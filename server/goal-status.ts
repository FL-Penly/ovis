/**
 * Downstream (FL-Penly/ovis, DOWNSTREAM.md): `GET /api/pane/goals`, the Claude Code and Codex panes of
 * this PC whose /goal is not met yet. herdr reads a pane at rest as done whatever its goal (a goal often
 * waits on background work), so the sidebar marks a goal still open beside that state.
 *
 * Codex keeps each thread's goal in `goals_1.sqlite` of its home. Claude Code writes a `goal_status`
 * record to its transcript when a goal is set (`sentinel`), judged not met, or met; `/goal clear` answers
 * "Goal cleared", and a goal stopped by a rate limit says "Goal paused · <why> · …" until the agent
 * answers again. Neither store is documented: what is not read as an open goal marks nothing.
 */
import { Database } from "bun:sqlite";
import { closeSync, openSync, readSync, statSync } from "node:fs";
import { join } from "node:path";
import type { HerdrPane, SessionSnapshot } from "../shared/protocol.ts";
import { paneCodexHome } from "./codex.ts";
import { paneTranscript } from "./conversation.ts";
import { sessionSnapshot } from "./herdr/client.ts";
import { badRequest, errorResponse, jsonResponse, setRequestRoute } from "./http.ts";

/** A goal not met yet. `paused` says why it stopped (a rate limit, Codex's blocked or a spent budget), null while it runs. */
export interface OpenGoal {
  objective: string;
  since: number | null;
  paused: string | null;
  tokens?: number;
  seconds?: number;
}

type Transcript = { source: "claude-transcript"; path: string } | { source: "codex-transcript"; path: string; home: string };

export interface GoalSources {
  snapshot: () => Promise<SessionSnapshot>;
  transcript: (pane: HerdrPane, snapshot: SessionSnapshot) => Promise<Transcript | null>;
}

const DEFAULT_SOURCES: GoalSources = {
  snapshot: sessionSnapshot,
  async transcript(pane, snapshot) {
    const home = pane.agent === "codex" ? await paneCodexHome(pane.pane_id) : undefined;
    const found = await paneTranscript(pane.pane_id, home, snapshot).catch(() => null);
    if (found?.source === "claude-transcript") return { source: found.source, path: found.path };
    if (found?.source === "codex-transcript" && home !== undefined) return { source: found.source, path: found.path, home };
    return null;
  },
};

interface ClaudeRead { file: string; offset: number; goal: OpenGoal | null }

const CHUNK = 4 * 1024 * 1024;
const claudeReads = new Map<string, ClaudeRead>();

const record = (line: string): Record<string, unknown> | null => {
  try {
    const value: unknown = JSON.parse(line);
    return value !== null && typeof value === "object" ? value as Record<string, unknown> : null;
  } catch { return null; }
};

const at = (entry: Record<string, unknown>): number | null => {
  const time = typeof entry["timestamp"] === "string" ? Date.parse(entry["timestamp"]) : NaN;
  return Number.isFinite(time) ? time : null;
};

/** The goal after one transcript line; most lines leave it as it was, and only those that may matter are parsed. */
export function claudeGoalAfter(goal: OpenGoal | null, line: string): OpenGoal | null {
  if (line.includes("\"goal_status\"")) {
    const entry = record(line);
    const status = entry?.["type"] === "attachment" ? entry["attachment"] as Record<string, unknown> | undefined : undefined;
    if (status?.["type"] !== "goal_status") return goal;
    if (status["met"] === true) return null;
    if (typeof status["condition"] !== "string") return goal;
    // a goal judged not met yet keeps the time it was set
    const same = goal !== null && status["sentinel"] !== true && goal.objective === status["condition"];
    return { objective: status["condition"], since: same ? goal.since : at(entry!), paused: null };
  }
  if (goal === null) return null;
  if (line.includes("<local-command-stdout>Goal cleared")) {
    const entry = record(line);
    const content = (entry?.["message"] as Record<string, unknown> | undefined)?.["content"];
    return entry?.["type"] === "user" && typeof content === "string" && content.startsWith("<local-command-stdout>Goal cleared") ? null : goal;
  }
  if (line.includes("Goal paused")) {
    const entry = record(line);
    const content = entry?.["content"];
    if (entry?.["type"] !== "system" || typeof content !== "string" || !content.startsWith("Goal paused")) return goal;
    return { ...goal, paused: content.split(" · ")[1]?.trim() || "paused" };
  }
  // the agent answering again is the goal going on after its pause
  if (goal.paused !== null && line.startsWith("{") && line.includes("\"type\":\"assistant\"")) return { ...goal, paused: null };
  return goal;
}

export function claudeGoal(path: string, reads: Map<string, ClaudeRead> = claudeReads, chunk = CHUNK): OpenGoal | null {
  const stat = statSync(path);
  const file = `${stat.dev}:${stat.ino}`;
  let read = reads.get(path);
  if (read === undefined || read.file !== file || read.offset > stat.size) read = { file, offset: 0, goal: null };
  const fd = openSync(path, "r");
  try {
    // split on bytes: a chunk may end inside a character, and the offset counts bytes
    let carry: Buffer = Buffer.alloc(0);
    while (read.offset + carry.length < stat.size) {
      const start = read.offset + carry.length;
      const bytes = Buffer.allocUnsafe(Math.min(chunk, stat.size - start));
      const got = readSync(fd, bytes, 0, bytes.length, start);
      if (got <= 0) break;
      const data = Buffer.concat([carry, bytes.subarray(0, got)]);
      const end = data.lastIndexOf(0x0a);
      if (end < 0) { carry = data; continue; }
      for (const line of data.subarray(0, end).toString("utf8").split("\n")) read.goal = claudeGoalAfter(read.goal, line);
      read.offset += end + 1;
      carry = data.subarray(end + 1);
    }
  } finally { closeSync(fd); }
  reads.set(path, read);
  if (reads.size > 256) reads.delete(reads.keys().next().value!);
  return read.goal;
}

const THREAD = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i;

export function codexThread(rolloutPath: string): string | null {
  return THREAD.exec(rolloutPath)?.[1]?.toLowerCase() ?? null;
}

interface GoalRow { objective: string; status: string; tokens_used: number; time_used_seconds: number; created_at_ms: number }

export function codexGoals(home: string, threads: readonly string[]): Map<string, OpenGoal> {
  const found = new Map<string, OpenGoal>();
  if (threads.length === 0) return found;
  let db: Database | null = null;
  try {
    db = new Database(join(home, "goals_1.sqlite"), { readonly: true, create: false });
    const rows = db.query(`SELECT thread_id, objective, status, tokens_used, time_used_seconds, created_at_ms FROM thread_goals WHERE thread_id IN (${threads.map(() => "?").join(", ")})`)
      .all(...threads) as (GoalRow & { thread_id: string })[];
    for (const row of rows) {
      if (row.status === "complete" || typeof row.objective !== "string") continue;
      found.set(row.thread_id, {
        objective: row.objective,
        since: Number.isFinite(row.created_at_ms) ? row.created_at_ms : null,
        paused: row.status === "active" ? null : row.status.replaceAll("_", " "),
        tokens: row.tokens_used,
        seconds: row.time_used_seconds,
      });
    }
  } catch { /* no goals store (a Codex before /goal), or one being migrated: no marks */ }
  finally { db?.close(); }
  return found;
}

/** pane id → its open goal, for each Claude Code or Codex pane of this PC that has one. */
export async function openGoals(sources: GoalSources = DEFAULT_SOURCES): Promise<Record<string, OpenGoal>> {
  const snapshot = await sources.snapshot();
  const agents = snapshot.panes.filter((pane) => pane.agent === "claude" || pane.agent === "codex");
  const transcripts = await Promise.all(agents.map(async (pane) => ({ pane, transcript: await sources.transcript(pane, snapshot).catch(() => null) })));
  const found: Record<string, OpenGoal> = {};
  const threadsByHome = new Map<string, { paneId: string; thread: string }[]>();
  for (const { pane, transcript } of transcripts) {
    if (transcript?.source === "claude-transcript") {
      try {
        const goal = claudeGoal(transcript.path);
        if (goal) found[pane.pane_id] = goal;
      } catch { /* a transcript gone between the lookup and the read */ }
    } else if (transcript?.source === "codex-transcript") {
      const thread = codexThread(transcript.path);
      if (thread) threadsByHome.set(transcript.home, [...threadsByHome.get(transcript.home) ?? [], { paneId: pane.pane_id, thread }]);
    }
  }
  for (const [home, wanted] of threadsByHome) {
    const goals = codexGoals(home, wanted.map((item) => item.thread));
    for (const { paneId, thread } of wanted) {
      const goal = goals.get(thread);
      if (goal) found[paneId] = goal;
    }
  }
  return found;
}

// every open browser tab asks: one look at a time, shared for a moment
const SHARED_MS = 2_000;
let shared: { at: number; answer: Promise<Record<string, OpenGoal>> } | null = null;

export async function handleGoalsRequest(request: Request, pathname: string): Promise<Response> {
  setRequestRoute(pathname);
  if (request.method !== "GET") return badRequest("method_not_allowed", "use GET");
  try {
    if (shared === null || Date.now() - shared.at > SHARED_MS) {
      const answer = openGoals();
      shared = { at: Date.now(), answer };
      answer.catch(() => { if (shared?.answer === answer) shared = null; });
    }
    return jsonResponse({ panes: await shared.answer });
  } catch (error) {
    return errorResponse(error);
  }
}
