// Downstream (FL-Penly/ovis, DOWNSTREAM.md): the inline diff's height (GitPanel.tsx).
import { describe, expect, it } from "bun:test";
import { shownRows } from "./GitPanel.tsx";

describe("shownRows", () => {
  it("counts a hunk's lines and its separator, not the file's header lines", () => {
    const patch = "diff --git a/a.ts b/a.ts\nindex 1..2 100644\n--- a/a.ts\n+++ b/a.ts\n@@ -5,3 +5,3 @@\n a\n-b\n+c\n d\n";
    expect(shownRows(patch)).toBe(4 + 2 + 1);
  });

  it("gives each hunk its separator and leaves git's no-newline note out", () => {
    const patch = "diff --git a/a b/a\n@@ -1 +1 @@\n-x\n+y\n\\ No newline at end of file\n@@ -9 +9 @@\n-p\n+q\n";
    expect(shownRows(patch)).toBe(4 + 2 * 2 + 1);
  });
});
