// Downstream (FL-Penly/ovis, DOWNSTREAM.md): the phone keys' items and the input line's lists (phoneKeys.ts).
import { beforeEach, describe, expect, it } from "bun:test";
import { comboItem, HISTORY_LIMIT, NONE, readHistory, readPhrases, rememberLine, removePhrase, savePhrase } from "./phoneKeys.ts";

const store = new Map<string, string>();
globalThis.localStorage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, value); } } as Storage;

describe("comboItem", () => {
  it("sends a key under the latched modifiers as an exact chord", () => {
    expect(comboItem("l", { ctrl: true, alt: false, shift: false })).toEqual({ type: "key", key: "l", modifiers: { ctrl: true, alt: false, shift: false } });
    expect(comboItem("F5", { ctrl: false, alt: true, shift: true })).toEqual({ type: "key", key: "F5", modifiers: { ctrl: false, alt: true, shift: true } });
  });

  it("types Shift alone on a letter as the capital letter, and a bare key with no modifiers", () => {
    expect(comboItem("q", { ctrl: false, alt: false, shift: true })).toEqual({ type: "key", key: "Q", modifiers: NONE });
    expect(comboItem("Escape", NONE)).toEqual({ type: "key", key: "Escape", modifiers: NONE });
  });
});

describe("history and phrases", () => {
  beforeEach(() => store.clear());

  it("keeps the last lines sent, newest first, each once", () => {
    for (let index = 0; index < HISTORY_LIMIT + 2; index++) rememberLine(`line ${index}`);
    rememberLine("line 5");
    const history = readHistory();
    expect(history).toHaveLength(HISTORY_LIMIT);
    expect(history[0]).toBe("line 5");
    expect(history.filter((line) => line === "line 5")).toHaveLength(1);
    expect(rememberLine("   ")).toEqual(history);
  });

  it("saves a phrase once, in order, and removes it", () => {
    savePhrase("git status");
    savePhrase("git status");
    savePhrase(" claude ");
    expect(readPhrases()).toEqual(["git status", "claude"]);
    expect(removePhrase("git status")).toEqual(["claude"]);
  });

  it("reads a broken store as empty", () => {
    store.set("ovis-downstream:line-phrases", "{oops");
    expect(readPhrases()).toEqual([]);
  });
});
