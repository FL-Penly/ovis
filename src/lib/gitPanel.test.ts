// Downstream (FL-Penly/ovis, DOWNSTREAM.md): the commit graph's layout (gitPanel.ts).
import { describe, expect, it } from "bun:test";
import type { GitCommit } from "../../shared/git-panel.ts";
import { layoutGraph, splitPath } from "./gitPanel.ts";

const commit = (hash: string, ...parents: string[]): GitCommit => ({ hash, parents, refs: [], author: "a", time: 0, subject: hash });

describe("layoutGraph", () => {
  it("draws a straight history in one lane", () => {
    const rows = layoutGraph([commit("c", "b"), commit("b", "a"), commit("a")]);
    expect(rows.map((row) => [row.lane, row.top, row.bottom, row.width])).toEqual([
      [0, [], [[0, 0]], 1],
      [0, [[0, 0]], [[0, 0]], 1],
      [0, [[0, 0]], [], 1],
    ]);
  });

  it("opens a lane for a merge's second parent and closes it where the branches meet", () => {
    // m merges f into main; f and b both come from a
    const rows = layoutGraph([commit("m", "b", "f"), commit("f", "a"), commit("b", "a"), commit("a")]);
    expect(rows.map((row) => row.lane)).toEqual([0, 1, 0, 0]);
    expect(rows[0]!.bottom).toEqual([[0, 0], [0, 1]]);
    // f's lane passes b, then joins a's lane at a
    expect(rows[2]!.bottom).toEqual([[0, 0], [1, 1]]);
    expect(rows[3]!.top).toEqual([[0, 0], [1, 0]]);
    expect(rows.map((row) => row.width)).toEqual([2, 2, 2, 2]);
  });

  it("puts a second head beside the first and reuses freed lanes", () => {
    const rows = layoutGraph([commit("x", "a"), commit("y", "a"), commit("a")]);
    expect(rows.map((row) => row.lane)).toEqual([0, 1, 0]);
    expect(rows[2]!.top).toEqual([[0, 0], [1, 0]]);
    expect(rows[2]!.width).toBe(2);
  });
});

describe("splitPath", () => {
  it("splits a path into its name and its folder", () => {
    expect(splitPath("src/lib/a.ts")).toEqual({ name: "a.ts", folder: "src/lib" });
    expect(splitPath("a.ts")).toEqual({ name: "a.ts", folder: "" });
  });
});
