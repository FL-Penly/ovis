import { afterEach, beforeEach, expect, it, spyOn } from "bun:test";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import type { Machine } from "../../shared/machines.ts";
import machinesFixture from "../../site/demo/fixtures/machines.json";
import { notePick, pickShown, pickVersion } from "./explicitPick.ts";
import { PANE_COVER_SELECTOR } from "./panePresentation.ts";
import { loadSeen } from "./seenFinishes.ts";
import { useSidebarActivityState } from "./sidebarActivity.tsx";

type Marker = { name: "data-pane-shown" | "data-pane-content"; key: string; error?: boolean };
const keyOf = (pane: string, finish: number, view = "chat") => JSON.stringify(["local", pane, "term_1", view, "epoch-a", finish]);
const done = (pane: string, finish: number) => ({ pane_id: pane, agent_status: "done" as const, finish_id: finish });

let markers: Marker[];
let covers: number;
let observed: (() => void) | null;
const globals = ["document", "window", "localStorage", "getComputedStyle", "MutationObserver", "IS_REACT_ACT_ENVIRONMENT"] as const;
const before = new Map<string, PropertyDescriptor | undefined>();

beforeEach(() => {
  markers = []; covers = 0; observed = null;
  for (const key of globals) before.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  const data = new Map<string, string>();
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
  Object.defineProperty(globalThis, "window", { configurable: true, value: { addEventListener() {}, removeEventListener() {} } });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    get length() { return data.size; }, key: (index: number) => [...data.keys()][index] ?? null,
    getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
  } });
  Object.defineProperty(globalThis, "document", { configurable: true, value: {
    body: {}, visibilityState: "visible", addEventListener() {}, removeEventListener() {},
    querySelectorAll: (selector: string) => selector === PANE_COVER_SELECTOR
      ? Array.from({ length: covers }, () => ({ closest: () => null, getClientRects: () => [{}], visibility: "visible" }))
      : markers.map((marker) => ({
        getAttribute: (name: string) => name === marker.name ? marker.key : null,
        querySelector: () => marker.error ? {} : null,
      })),
  } });
  Object.defineProperty(globalThis, "getComputedStyle", { configurable: true, value: (node: { visibility: string }) => ({ visibility: node.visibility }) });
  Object.defineProperty(globalThis, "MutationObserver", { configurable: true, value: class {
    constructor(callback: () => void) { observed = callback; }
    observe() {}
    disconnect() { observed = null; }
  } });
});

afterEach(() => {
  notePick("local", { pane_id: "none", agent_status: "idle" }, undefined);
  for (const [key, descriptor] of before) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

it("reads a picked finish once its chat is drawn, wherever it is scrolled, and only once", () => {
  notePick("local", done("p1", 3), "epoch-a");
  expect(pickShown("local", done("p1", 3), "epoch-a")).toBe(false);
  const version = pickVersion();
  markers.push({ name: "data-pane-shown", key: keyOf("p1", 3) });
  observed?.();
  expect(pickVersion()).toBe(version + 1);
  observed?.();
  expect(pickVersion()).toBe(version + 1);
  expect(pickShown("local", done("p1", 3), "epoch-a")).toBe(true);
  expect(pickShown("local", done("p1", 3), "epoch-a")).toBe(false);
});

it("takes the terminal's own presentation marker too", () => {
  markers.push({ name: "data-pane-content", key: keyOf("p1", 3, "terminal") });
  notePick("local", done("p1", 3), "epoch-a");
  expect(pickShown("local", done("p1", 3), "epoch-a")).toBe(true);
});

it("reads nothing under a dialog or menu, nor content that failed to render", () => {
  markers.push({ name: "data-pane-shown", key: keyOf("p1", 3), error: true });
  notePick("local", done("p1", 3), "epoch-a");
  expect(pickShown("local", done("p1", 3), "epoch-a")).toBe(false);
  markers[0]!.error = false; covers = 1;
  expect(pickShown("local", done("p1", 3), "epoch-a")).toBe(false);
  covers = 0;
  expect(pickShown("local", done("p1", 3), "epoch-a")).toBe(true);
});

it("leaves a later finish, another pane or another epoch to upstream's rules", () => {
  markers.push({ name: "data-pane-shown", key: keyOf("p1", 4) }, { name: "data-pane-shown", key: keyOf("p2", 3) });
  notePick("local", done("p1", 3), "epoch-a");
  expect(pickShown("local", done("p1", 4), "epoch-a")).toBe(false);
  expect(pickShown("local", done("p2", 3), "epoch-a")).toBe(false);
  expect(pickShown("local", done("p1", 3), "epoch-b")).toBe(false);
  expect(pickShown("other", done("p1", 3), "epoch-a")).toBe(false);
});

it("picks nothing on a pane that is not done, waits on background work, or has no finish yet", () => {
  markers.push({ name: "data-pane-shown", key: keyOf("p1", 3) });
  for (const pane of [{ ...done("p1", 3), agent_status: "working" as const }, { ...done("p1", 3), background_wait: true as const }, done("p1", 0)]) {
    notePick("local", pane, "epoch-a");
    expect(pickShown("local", done("p1", 3), "epoch-a")).toBe(false);
  }
  notePick("local", done("p1", 3), undefined);
  expect(pickShown("local", done("p1", 3), "epoch-a")).toBe(false);
});

it("forgets a pick whose pane never showed in time", () => {
  const now = spyOn(Date, "now").mockReturnValue(1_000);
  try {
    notePick("local", done("p1", 3), "epoch-a");
    markers.push({ name: "data-pane-shown", key: keyOf("p1", 3) });
    now.mockReturnValue(1_000 + 30_001);
    expect(pickShown("local", done("p1", 3), "epoch-a")).toBe(false);
  } finally { now.mockRestore(); }
});

it("a new press replaces the last one", () => {
  markers.push({ name: "data-pane-shown", key: keyOf("p1", 3) }, { name: "data-pane-shown", key: keyOf("p2", 5) });
  notePick("local", done("p1", 3), "epoch-a");
  notePick("local", done("p2", 5), "epoch-a");
  expect(pickShown("local", done("p1", 3), "epoch-a")).toBe(false);
  expect(pickShown("local", done("p2", 5), "epoch-a")).toBe(true);
});

it("the sidebar reads a picked finish its pane shows, though upstream's proof is missing", async () => {
  const machine: Machine = structuredClone(machinesFixture.machines[0] as Machine);
  const pane = machine.snapshot!.panes[0]!;
  machine.id = "local";
  machine.snapshot!.finish_epoch = "epoch-a";
  machine.snapshot!.panes = [{ ...pane, pane_id: "p1", terminal_id: "term_1", agent_status: "done", finish_id: 3 }];
  function Probe() {
    useSidebarActivityState([machine], "local", "p1", () => false);
    return null;
  }
  let renderer: ReactTestRenderer | undefined;
  await act(async () => { renderer = create(createElement(Probe)); });
  try {
    expect(loadSeen("local", "epoch-a")).toEqual({});
    await act(async () => { notePick("local", machine.snapshot!.panes[0]!, "epoch-a"); });
    expect(loadSeen("local", "epoch-a")).toEqual({});
    markers.push({ name: "data-pane-shown", key: keyOf("p1", 3) });
    await act(async () => { observed?.(); });
    expect(loadSeen("local", "epoch-a")).toEqual({ p1: 3 });
  } finally {
    await act(async () => { renderer?.unmount(); });
  }
});
