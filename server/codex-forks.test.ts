// Downstream (FL-Penly/ovis, DOWNSTREAM.md): a Codex pane beside a fork of its conversation (matchBesideForks).
import { afterEach, beforeEach, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { codexTranscriptPath } from "./codex.ts";

const original = "01a16e64-a226-7863-8b67-b7f4fcebffee";
const fork = "da52ec88-5bc2-4027-bbda-22880f552c6d";
const prompt = "Explain what this project is for";
const answer = "This project is a command line toolkit that wraps the team's internal platforms behind one runtime and one error contract.";
let root: string;
let home: string;
let originalPath: string;
let forkPath: string;
let screens: Map<string, string>;
let foregrounds: Map<string, { pid: number; argv: string[] }[]>;
let listener: ReturnType<typeof Bun.listen>;
let socketBefore: string | undefined;

const rollout = (path: string, id: string) => writeFileSync(path, [
  { type: "session_meta", payload: { id, cwd: root } },
  { type: "event_msg", payload: { type: "user_message", message: prompt } },
  { type: "event_msg", payload: { type: "agent_message", message: answer } },
].map((entry) => `${JSON.stringify(entry)}\n`).join(""));

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ovis-codex-forks-"));
  home = join(root, "codex");
  mkdirSync(join(home, "sessions"), { recursive: true });
  originalPath = join(home, "sessions", `rollout-2026-10-24T22-50-51-${original}.jsonl`);
  forkPath = join(home, "sessions", `rollout-2026-10-24T22-55-02-${fork}.jsonl`);
  // quick-fork's copy: the same history under the fork's own id
  rollout(originalPath, original);
  rollout(forkPath, fork);
  const db = new Database(join(home, "state_5.sqlite"));
  db.exec("CREATE TABLE threads (id TEXT, rollout_path TEXT, cwd TEXT, archived INTEGER, agent_role TEXT, created_at INTEGER, updated_at INTEGER, source TEXT, first_user_message TEXT)");
  // a backtrack in the original gives its thread a new created_at, after the fork's pane started
  db.query("INSERT INTO threads VALUES (?, ?, ?, 0, NULL, 3000, 3000, 'cli', ?)").run(original, originalPath, root, prompt);
  db.query("INSERT INTO threads VALUES (?, ?, ?, 0, NULL, 2000, 2000, 'cli', ?)").run(fork, forkPath, root, prompt);
  db.close();
  screens = new Map([
    ["original", `OpenAI Codex (v0.164.0)\n\n› ${prompt}\n\n• ${answer}\n\n• Conversation reverted to this point.\n\n› `],
    ["fork", "/status\n\n  >_ OpenAI Codex (v0.164.0)\n\n  Session: da52ec88\n\n› "],
  ]);
  foregrounds = new Map([
    ["original", [{ pid: 900001, argv: [join(root, "codex")] }]],
    ["fork", [{ pid: 900002, argv: [join(root, "codex"), "resume", fork] }]],
  ]);
  socketBefore = process.env["HERDR_SOCKET"];
  const socket = join(root, "herdr.sock");
  process.env["HERDR_SOCKET"] = socket;
  listener = Bun.listen<{ buffer: string }>({
    unix: socket,
    socket: {
      open(socket) { socket.data = { buffer: "" }; },
      data(socket, chunk) {
        socket.data.buffer += chunk.toString();
        if (!socket.data.buffer.includes("\n")) return;
        const request = JSON.parse(socket.data.buffer) as { id: string; method: string; params?: { pane_id?: string } };
        const pane = request.params?.pane_id ?? "";
        const result = request.method === "agent.get" ? { agent: {} }
          : request.method === "pane.process_info" ? { process_info: { foreground_processes: foregrounds.get(pane) ?? [] } }
          : request.method === "pane.read" ? { read: { text: screens.get(pane) ?? "" } }
          : null;
        if (result === null) throw new Error(`unexpected RPC ${request.method}`);
        socket.end(`${JSON.stringify({ id: request.id, result })}\n`);
      },
    },
  });
});

afterEach(() => {
  listener.stop(true);
  if (socketBefore === undefined) delete process.env["HERDR_SOCKET"];
  else process.env["HERDR_SOCKET"] = socketBefore;
  rmSync(root, { recursive: true, force: true });
});

const pane = (id: string) => ({
  pane_id: id, workspace_id: "w", tab_id: "t", terminal_id: id,
  agent: "codex" as const, agent_status: "idle" as const, cwd: root, focused: false, revision: 0,
});
const panes = () => [pane("original"), pane("fork")];

it("tells the original from a fork resumed in another pane, and the fork from the original", async () => {
  expect(await codexTranscriptPath("original", root, home, panes())).toBe(originalPath);
  expect(await codexTranscriptPath("fork", root, home, panes())).toBe(forkPath);
});

it("tells the fork's pane its own thread before the original's chat was ever opened", async () => {
  expect(await codexTranscriptPath("fork", root, home, panes())).toBe(forkPath);
});

it("stays unsure while no pane was started on the fork (control)", async () => {
  foregrounds.set("fork", [{ pid: 900002, argv: [join(root, "codex")] }]);
  expect(await codexTranscriptPath("original", root, home, panes())).toBeNull();
});
