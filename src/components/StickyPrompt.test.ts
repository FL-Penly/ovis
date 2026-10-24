// Downstream (FL-Penly/ovis, DOWNSTREAM.md): which prompt the sticky prompt pins (StickyPrompt.tsx).
import { describe, expect, it } from "bun:test";
import { stickyTurn } from "./StickyPrompt.tsx";

describe("stickyTurn", () => {
  // the user's turns stand at timeline rows 0, 4 and 9; each answer fills the rows after its turn
  const rows = [0, 4, 9];

  it("pins the prompt of the answer the view's top is in, once that prompt has scrolled above it", () => {
    expect(stickyTurn(rows, 2)).toBe(0);
    expect(stickyTurn(rows, 5)).toBe(1);
    expect(stickyTurn(rows, 30)).toBe(2);
  });

  it("pins nothing while the prompt itself still shows at the top, or before the first prompt", () => {
    expect(stickyTurn(rows, 0)).toBeNull();
    expect(stickyTurn(rows, 4)).toBeNull();
    expect(stickyTurn(rows, 9)).toBeNull();
    expect(stickyTurn([3], 1)).toBeNull();
    expect(stickyTurn([], 5)).toBeNull();
  });
});
