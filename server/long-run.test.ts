import { describe, expect, test } from "bun:test";
import { compactWindow, launchEnvFault, windowLabel } from "../shared/long-run.ts";
import type { HerdrPane } from "../shared/protocol.ts";
import { longRunPanes } from "./long-run.ts";

const pane = (pane_id: string, agent: string | null) => ({ pane_id, agent }) as unknown as HerdrPane;

describe("long run", () => {
  test("reads a window as Claude Code does", () => {
    expect(compactWindow("500000")).toBe(500_000);
    expect(compactWindow("500k")).toBe(500_000);
    expect(compactWindow("1.2M")).toBe(1_200_000);
    expect(compactWindow("")).toBeNull();
    expect(compactWindow("lots")).toBeNull();
    expect(windowLabel(500_000)).toBe("500k");
    expect(windowLabel(1_000_000)).toBe("1m");
  });

  test("a request may set the window alone, as a count", () => {
    expect(launchEnvFault(undefined)).toBeNull();
    expect(launchEnvFault({ CLAUDE_CODE_AUTO_COMPACT_WINDOW: "500000" })).toBeNull();
    expect(launchEnvFault({ LD_PRELOAD: "/tmp/x.so" })).not.toBeNull();
    expect(launchEnvFault({ CLAUDE_CODE_AUTO_COMPACT_WINDOW: "500000", PATH: "/tmp" })).not.toBeNull();
    expect(launchEnvFault({ CLAUDE_CODE_AUTO_COMPACT_WINDOW: "5; rm -rf ~" })).not.toBeNull();
    expect(launchEnvFault(["CLAUDE_CODE_AUTO_COMPACT_WINDOW=500000"])).not.toBeNull();
  });

  test("lists the Claude panes whose process sets a window, reading each pid once", async () => {
    const reads: number[] = [];
    const environs: Record<number, string[] | null> = {
      1: ["HOME=/h", "CLAUDE_CODE_AUTO_COMPACT_WINDOW=500000"],
      2: ["HOME=/h"],
      3: null,
    };
    const sources = {
      panes: async () => [pane("a", "claude"), pane("b", "claude"), pane("c", "claude"), pane("d", "codex"), pane("e", null)],
      pid: async (p: HerdrPane) => ({ a: 1, b: 2, c: 3, d: 4 } as Record<string, number>)[p.pane_id] ?? null,
      environ: (pid: number) => { reads.push(pid); return environs[pid] ?? null; },
    };
    const cache = new Map<number, number | null>();
    expect(await longRunPanes(sources, cache)).toEqual({ a: 500_000 });
    environs[3] = ["CLAUDE_CODE_AUTO_COMPACT_WINDOW=300k"];
    expect(await longRunPanes(sources, cache)).toEqual({ a: 500_000, c: 300_000 });
    expect(reads.sort()).toEqual([1, 2, 3, 3]);
  });
});
