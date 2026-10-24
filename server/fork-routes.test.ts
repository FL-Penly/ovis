import { describe, expect, it } from "bun:test";
import { claudeForkPoint, codexForkPoint } from "./fork-routes.ts";

const jsonl = (rows: object[]): string => rows.map((row) => JSON.stringify(row)).join("\n") + "\n";

describe("claudeForkPoint", () => {
  const transcript = jsonl([
    { type: "user", uuid: "u1", timestamp: "2026-10-24T10:00:00.000Z", message: { role: "user", content: "hi" } },
    { type: "assistant", uuid: "a1", timestamp: "2026-10-24T10:00:01.000Z", message: { content: [{ type: "tool_use", id: "t1", name: "Bash", input: {} }] } },
    { type: "assistant", uuid: "side", timestamp: "2026-10-24T10:00:02.000Z", isSidechain: true, message: { content: [{ type: "text", text: "sub" }] } },
    { type: "assistant", uuid: "a2", timestamp: "2026-10-24T10:00:02.000Z", message: { content: [{ type: "text", text: "done" }] } },
    { type: "assistant", uuid: "a3", timestamp: "2026-10-24T10:00:02.000Z", message: { content: [{ type: "thinking", thinking: "…" }] } },
  ]);

  it("picks the main-thread record with text written at the reply's end", () => {
    expect(claudeForkPoint(transcript, "2026-10-24T10:00:02.000Z")).toBe("a2");
  });

  it("falls back to a record without text when the reply ended on one", () => {
    expect(claudeForkPoint(transcript, "2026-10-24T10:00:01.000Z")).toBe("a1");
  });

  it("finds nothing for a timestamp no assistant record has", () => {
    expect(claudeForkPoint(transcript, "2026-10-24T10:00:00.000Z")).toBeNull();
    expect(claudeForkPoint(transcript + "{torn", "2026-10-24T09:00:00.000Z")).toBeNull();
  });
});

describe("codexForkPoint", () => {
  const rows = [
    { type: "session_meta", timestamp: "2026-10-24T10:00:00.000Z", payload: { id: "s" } },
    { type: "event_msg", timestamp: "2026-10-24T10:00:05.000Z", payload: { type: "agent_message", message: "中文" } },
    { type: "event_msg", timestamp: "2026-10-24T10:00:05.000Z", payload: { type: "task_complete" } },
    { type: "event_msg", timestamp: "2026-10-24T10:01:00.000Z", payload: { type: "turn_aborted" } },
  ];
  const text = jsonl(rows);
  const path = "/home/me/.codex/sessions/2026/10/24/rollout-x.jsonl";

  it("cuts in bytes just past the record that ended the turn", () => {
    const at = codexForkPoint(path, text, "2026-10-24T10:00:05.000Z");
    const offset = Number(at!.split("#")[1]);
    expect(at!.startsWith(`${path}#`)).toBe(true);
    expect(offset).toBe(Buffer.byteLength(jsonl(rows.slice(0, 3)), "utf8"));
  });

  it("takes an interrupted turn's end too", () => {
    expect(codexForkPoint(path, text, "2026-10-24T10:01:00.000Z")).toBe(`${path}#${Buffer.byteLength(text, "utf8")}`);
  });

  it("refuses a record that is not a turn's end or a line still being written", () => {
    expect(codexForkPoint(path, text, "2026-10-24T10:00:00.000Z")).toBeNull();
    const torn = jsonl(rows.slice(0, 2)) + JSON.stringify(rows[2]);
    expect(codexForkPoint(path, torn, "2026-10-24T10:00:05.000Z")).toBeNull();
  });
});
