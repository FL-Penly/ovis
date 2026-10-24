import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

/** Where `cargo build --release` in crates/pty-sidecar puts the Rust PTY host. */
export const RUST_SIDECAR_BUILD = join(import.meta.dir, "..", "..", "crates", "pty-sidecar", "target", "release", "ovis-pty-sidecar");
/** Where a release's host is installed beside the server (scripts/pty-sidecar.ts install, a remote PC bundle's bin/). */
export const RUST_SIDECAR_INSTALLED = join(import.meta.dir, "..", "..", "bin", "ovis-pty-sidecar");

const vouched = new Map<string, boolean>();

/**
 * Whether the installed host is the one its record (`<binary>.json`, written by scripts/pty-sidecar.ts
 * install or the remote bundle's builder) vouches for: the same SHA-256, for the version in the
 * package.json beside the server. Taken once per file state, so attaches do not hash it again.
 */
export function installedHostVouched(installed: string, packageJson = join(dirname(installed), "..", "package.json")): boolean {
  try {
    const stat = statSync(installed);
    const recordStat = statSync(`${installed}.json`);
    const key = `${installed}:${stat.mtimeMs}:${stat.size}:${stat.ino}:${recordStat.mtimeMs}:${recordStat.size}`;
    const known = vouched.get(key);
    if (known !== undefined) return known;
    const record = JSON.parse(readFileSync(`${installed}.json`, "utf8")) as { sha256?: unknown; version?: unknown };
    const version = (JSON.parse(readFileSync(packageJson, "utf8")) as { version?: unknown }).version;
    const ok = typeof record.sha256 === "string" && record.version === version
      && createHash("sha256").update(readFileSync(installed)).digest("hex") === record.sha256;
    vouched.set(key, ok);
    return ok;
  } catch {
    return false;
  }
}

/** The host to run without OVIS_PTY_SIDECAR_BIN: the installed release's when its record vouches for it, else a local build. */
export function defaultRustSidecar(installed = RUST_SIDECAR_INSTALLED): string {
  return existsSync(installed) && installedHostVouched(installed) ? installed : RUST_SIDECAR_BUILD;
}

let warned = false;

/**
 * The Rust PTY host to run, when OVIS_PTY_SIDECAR=rust asks for it (OVIS_PTY_SIDECAR_BIN, else the release
 * build): it takes pty-host.mjs's arguments and frames. Null otherwise, on Windows, or when the binary is
 * missing, which is said once.
 */
export function rustSidecar(env: Record<string, string | undefined> = process.env): string | null {
  if (env["OVIS_PTY_SIDECAR"] !== "rust" || process.platform === "win32") return null;
  const binary = env["OVIS_PTY_SIDECAR_BIN"] || defaultRustSidecar();
  if (existsSync(binary)) return binary;
  if (!warned) {
    warned = true;
    console.error(`OVIS_PTY_SIDECAR=rust: ${binary} does not exist (cargo build --release in crates/pty-sidecar); using the Node PTY sidecar`);
  }
  return null;
}

/** The PTY host's command before its own arguments: the Rust host when asked for and built, else `node <script>`. */
export function ptyHost(nodeScript: string, env: Record<string, string | undefined> = process.env): string[] {
  const rust = rustSidecar(env);
  return rust ? [rust] : ["node", nodeScript];
}
