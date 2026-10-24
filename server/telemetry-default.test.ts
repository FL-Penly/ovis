// Downstream (FL-Penly/ovis, DOWNSTREAM.md): a fresh install of this fork sends no usage counts until turned on.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Telemetry } from "./telemetry.ts";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe("telemetry default", () => {
  test("starts off when the entrypoint says so, and turns on when asked", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "telemetry-default-"));
    dirs.push(stateDir);
    const fetch = (async () => new Response(null, { status: 204 })) as unknown as typeof globalThis.fetch;
    const telemetry = new Telemetry({ stateDir, version: "0.0.0", env: {}, fetch, enabledByDefault: false });
    expect(telemetry.status().enabled).toBe(false);
    expect(JSON.parse(readFileSync(join(stateDir, "telemetry.json"), "utf8")).enabled).toBe(false);
    telemetry.change({ enabled: true });
    expect(telemetry.status().enabled).toBe(true);
  });
});
