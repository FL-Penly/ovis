// Downstream (FL-Penly/ovis, DOWNSTREAM.md): a supervisor under a home reached through a symlink.
import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultStateDir, updateStateDir } from "./update-state.ts";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("a supervisor started from a release under a symlinked home", () => {
  it("names the state dir as the launcher does, which resumes only a record under that name", () => {
    const base = realpathSync(mkdtempSync(join(tmpdir(), "ovis-symlinked-home-")));
    roots.push(base);
    const real = join(base, "real");
    mkdirSync(join(real, "herdr-web-ui"), { recursive: true });
    writeFileSync(join(real, "herdr-web-ui", "devices.json"), "{}");
    const config = join(base, "home");
    symlinkSync(real, config);
    const env = { XDG_CONFIG_HOME: config };
    const root = join(base, "checkout");
    const port = 7317;
    const launcher = defaultStateDir(env);
    expect(launcher).toBe(join(config, "herdr-web-ui"));
    // what Bun's import.meta.dir gives the supervisor: the release by its real path
    const directory = join(updateStateDir(root, port, join(real, "herdr-web-ui")), "release-next");
    mkdirSync(directory, { recursive: true });
    expect(defaultStateDir(env, { root, port, directory })).toBe(launcher);
    expect(updateStateDir(root, port, defaultStateDir(env, { root, port, directory }))).toBe(updateStateDir(root, port, launcher));
  });

  it("keeps the release's own dir when no default name is that dir", () => {
    const base = realpathSync(mkdtempSync(join(tmpdir(), "ovis-symlinked-home-")));
    roots.push(base);
    const elsewhere = join(base, "elsewhere");
    const root = join(base, "checkout");
    const directory = join(updateStateDir(root, 7317, elsewhere), "release-next");
    mkdirSync(directory, { recursive: true });
    expect(defaultStateDir({ XDG_CONFIG_HOME: join(base, "config") }, { root, port: 7317, directory })).toBe(elsewhere);
  });
});
