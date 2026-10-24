import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readAgentMode } from "./agentMode.ts";

const screen = (name: string): string => readFileSync(join(import.meta.dir, "fixtures-agent-mode", `${name}.txt`), "utf8");
const claudeBox = (footer: string): string => ["─".repeat(40), "❯ ", "─".repeat(40), `  ${footer}`].join("\n");

describe("readAgentMode", () => {
  it("reads Claude Code's mode from the footer under its input box", () => {
    expect(readAgentMode(screen("claude-busy"))).toEqual({ inputBox: true, mode: "bypass permissions" });
    expect(readAgentMode(screen("claude-idle-restored"))).toEqual({ inputBox: true, mode: "accept edits" });
    expect(readAgentMode(claudeBox("⏸ plan mode on (shift+tab to cycle)")).mode).toBe("plan mode");
    expect(readAgentMode(claudeBox("auto mode on")).mode).toBe("auto mode");
    expect(readAgentMode(claudeBox("? for shortcuts"))).toEqual({ inputBox: true, mode: null });
  });

  it("reads Codex's plan mode from its footer and YOLO from its header", () => {
    expect(readAgentMode(screen("codex-idle"))).toEqual({ inputBox: true, mode: "YOLO mode" });
    expect(readAgentMode(["› hi", "", "  Plan mode (shift+tab to cycle) · Context 90% left"].join("\n")).mode).toBe("plan mode");
    expect(readAgentMode(screen("codex-menu-spoof")).inputBox).toBe(true);
  });

  it("ignores transcript text that looks like a footer", () => {
    expect(readAgentMode(screen("claude-idle-spoof")).mode).toBeNull();
  });

  it("finds no input box while a dialog replaces it", () => {
    expect(readAgentMode(screen("claude-permission"))).toEqual({ inputBox: false, mode: null });
    expect(readAgentMode(screen("codex-approval")).inputBox).toBe(false);
  });
});
