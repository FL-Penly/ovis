import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HerdrPane, SessionSnapshot } from "../shared/protocol.ts";
import { claudeGoal, claudeGoalAfter, codexGoals, codexThread, openGoals, type OpenGoal } from "./goal-status.ts";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const temp = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "ovis-goals-"));
  dirs.push(dir);
  return dir;
};

// the records as Claude Code 2.1.311 writes them
const goalStatus = (status: Record<string, unknown>, timestamp = "2026-10-26T10:46:54.000Z") =>
  JSON.stringify({ type: "attachment", timestamp, attachment: { type: "goal_status", ...status } });
const set = (condition: string, timestamp?: string) => goalStatus({ met: false, sentinel: true, condition }, timestamp);
const notMet = (condition: string) => goalStatus({ met: false, condition, reason: "The goal is not met: no MR exists." }, "2026-10-26T11:00:00.000Z");
const met = (condition: string) => goalStatus({ met: true, condition, reason: "Every requirement has evidence.", iterations: 1, durationMs: 3970469, tokens: 281891 });
const cleared = JSON.stringify({ type: "user", message: { role: "user", content: "<local-command-stdout>Goal cleared: Ship it</local-command-stdout>" } });
const paused = JSON.stringify({ type: "system", subtype: "informational", level: "notice", content: "Goal paused · the request was rate limited · send a message to retry" });
const answer = JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Going on." }] } });
const quoted = JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "tool_result", content: "<local-command-stdout>Goal cleared: Ship it" }] } });

const replay = (lines: readonly string[]): OpenGoal | null => lines.reduce<OpenGoal | null>(claudeGoalAfter, null);

describe("a Claude Code goal, from its transcript", () => {
  test("is open from its set until it is met, and keeps the time it was set while judged not met", () => {
    const since = Date.parse("2026-10-26T10:46:54.000Z");
    expect(replay([set("Ship it")])).toEqual({ objective: "Ship it", since, paused: null });
    expect(replay([set("Ship it"), answer, notMet("Ship it")])).toEqual({ objective: "Ship it", since, paused: null });
    expect(replay([set("Ship it"), notMet("Ship it"), met("Ship it")])).toBeNull();
  });

  test("a new goal starts its own time, and /goal clear ends it", () => {
    expect(replay([set("Ship it"), set("Then this", "2026-10-26T12:00:00.000Z")])?.since).toBe(Date.parse("2026-10-26T12:00:00.000Z"));
    expect(replay([set("Ship it"), cleared])).toBeNull();
    // a tool's output quoting the line clears nothing
    expect(replay([set("Ship it"), quoted])?.objective).toBe("Ship it");
  });

  test("a pause says why until the agent answers again", () => {
    expect(replay([set("Ship it"), paused])?.paused).toBe("the request was rate limited");
    expect(replay([set("Ship it"), paused, answer])?.paused).toBeNull();
    expect(replay([paused])).toBeNull();
  });

  test("reads only what was appended since its last read, across chunks that split a character", () => {
    const path = join(temp(), "session.jsonl");
    const reads = new Map();
    writeFileSync(path, `${answer}\n${set("完成「记忆」迁移")}\n${answer}`);
    expect(claudeGoal(path, reads, 7)?.objective).toBe("完成「记忆」迁移");
    appendFileSync(path, `\n${met("完成「记忆」迁移")}\n`);
    expect(claudeGoal(path, reads, 7)).toBeNull();
    appendFileSync(path, `${set("下一个")}\n`);
    expect(claudeGoal(path, reads)?.objective).toBe("下一个");
    // a file written over from its start is read again
    writeFileSync(path, `${answer}\n`);
    expect(claudeGoal(path, reads)).toBeNull();
  });
});

const goalsStore = (home: string, rows: readonly [string, string, string][]): void => {
  const db = new Database(join(home, "goals_1.sqlite"));
  db.run(`CREATE TABLE thread_goals (thread_id TEXT PRIMARY KEY NOT NULL, goal_id TEXT NOT NULL, objective TEXT NOT NULL,
    status TEXT NOT NULL, token_budget INTEGER, tokens_used INTEGER NOT NULL DEFAULT 0, time_used_seconds INTEGER NOT NULL DEFAULT 0,
    created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL)`);
  for (const [thread, objective, status] of rows) {
    db.run("INSERT INTO thread_goals VALUES (?, 'g', ?, ?, NULL, 1200, 60, 1792691150272, 1792693241446)", [thread, objective, status]);
  }
  db.close();
};

const A = "01a164b7-e20d-7a20-acb8-ee544f9a800d";
const B = "01a159aa-18ce-7e11-8181-60e6c95a612f";
const C = "01a158e4-d4a2-77f2-8dfe-90fe83ec10bb";

describe("a Codex goal, from its thread's row", () => {
  test("takes the thread from the rollout's name", () => {
    expect(codexThread(`/h/.codex/sessions/2026/10/23/rollout-2026-10-23T01-45-35-${A}.jsonl`)).toBe(A);
    expect(codexThread("/h/notes.jsonl")).toBeNull();
  });

  test("is open while not complete, and a stopped one says how", () => {
    const home = temp();
    goalsStore(home, [[A, "Fix it", "active"], [B, "Ship it", "complete"], [C, "Deploy it", "usage_limited"]]);
    const goals = codexGoals(home, [A, B, C, "01a15483-7d47-7043-8477-3975e1f8054f"]);
    expect(goals.get(A)).toEqual({ objective: "Fix it", since: 1792691150272, paused: null, tokens: 1200, seconds: 60 });
    expect(goals.has(B)).toBeFalse();
    expect(goals.get(C)?.paused).toBe("usage limited");
    expect(codexGoals(temp(), [A]).size).toBe(0);
  });
});

describe("the open goals of this PC's panes", () => {
  test("for Claude Code and Codex panes alone", async () => {
    const dir = temp();
    const transcript = join(dir, "claude.jsonl");
    writeFileSync(transcript, `${set("Ship it")}\n`);
    goalsStore(dir, [[A, "Fix it", "active"]]);
    const panes = [
      { pane_id: "p_1", agent: "claude" }, { pane_id: "p_2", agent: "codex" }, { pane_id: "p_3", agent: "codex" }, { pane_id: "p_4", agent: "pi" },
    ] as unknown as HerdrPane[];
    const asked: string[] = [];
    const goals = await openGoals({
      snapshot: async () => ({ panes } as unknown as SessionSnapshot),
      async transcript(pane) {
        asked.push(pane.pane_id);
        if (pane.pane_id === "p_1") return { source: "claude-transcript", path: transcript };
        if (pane.pane_id === "p_2") return { source: "codex-transcript", path: join(dir, `rollout-2026-10-23T01-45-35-${A}.jsonl`), home: dir };
        throw new Error("no transcript");
      },
    });
    expect(Object.keys(goals).sort()).toEqual(["p_1", "p_2"]);
    expect(goals["p_2"]?.objective).toBe("Fix it");
    expect(asked.sort()).toEqual(["p_1", "p_2", "p_3"]);
  });
});
