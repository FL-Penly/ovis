/**
 * The Rust PTY host (crates/pty-sidecar) as a release ships it, on Linux and macOS:
 *
 *   bun scripts/pty-sidecar.ts build <linux-x64|linux-arm64|darwin-universal> <dir>   CI: one asset into <dir>
 *   bun scripts/pty-sidecar.ts manifest <dir>   CI: ovis-pty-sidecar.json and SHA256SUMS for the assets in <dir>
 *   bun scripts/pty-sidecar.ts install [--strict]   this checkout: the release's binary into bin/ovis-pty-sidecar
 *
 * Linux assets are static (musl), so they run on any distribution; the macOS one is universal
 * (arm64 and x86_64) and ad-hoc signed. `install` runs at every herdr plugin install, every update
 * the app installs and every install.sh run. It takes the binary of the release named by
 * package.json's version, only when that release was built from this checkout's crate sources
 * (their git tree), checks its SHA-256 against the release's manifest and that it runs here, and
 * moves it into place in one rename. Without one, it says why and exits 0: the server then runs
 * the Node sidecar, as before. `--strict` exits 1 instead.
 */
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const CRATE = "crates/pty-sidecar";
export const NAME = "ovis-pty-sidecar";
export const MANIFEST = `${NAME}.json`;
/** where `install` puts the host, and where server/pty/host.ts looks first */
export const INSTALLED = join(root, "bin", NAME);
const RELEASES = "https://github.com/devswha/ovis/releases/download";

/** Each release asset and the Rust targets it is built from. */
export const ASSETS: Record<string, string[]> = {
  "linux-x64": ["x86_64-unknown-linux-musl"],
  "linux-arm64": ["aarch64-unknown-linux-musl"],
  "darwin-universal": ["aarch64-apple-darwin", "x86_64-apple-darwin"],
};
/** The asset each platform (`process.platform-process.arch`) runs. */
export const PLATFORM_ASSET: Record<string, string> = {
  "linux-x64": "linux-x64",
  "linux-arm64": "linux-arm64",
  "darwin-x64": "darwin-universal",
  "darwin-arm64": "darwin-universal",
};

export interface Manifest {
  version: string;
  /** git tree id of crates/pty-sidecar the assets were built from */
  crate: string;
  assets: Record<string, { file: string; sha256: string }>;
}

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
const packageVersion = (): string => (JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string }).version;

function command(argv: string[], timeout = 600_000): string {
  const result = Bun.spawnSync(argv, { cwd: root, timeout, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(`${argv.join(" ")} failed: ${result.stderr.toString().trim() || `exit ${result.exitCode}`}`);
  return result.stdout.toString().trim();
}

/** The crate's git tree id in this checkout, or null outside a git checkout. */
export function crateTree(cwd = root): string | null {
  const result = Bun.spawnSync(["git", "rev-parse", `HEAD:${CRATE}`], { cwd, stdout: "pipe", stderr: "ignore" });
  return result.exitCode === 0 ? result.stdout.toString().trim() : null;
}

/** Whether `path` is the Rust PTY host and runs on this PC: with no arguments it prints its usage and exits 2. */
export function runsHere(path: string): boolean {
  try {
    const result = Bun.spawnSync([path], { stdin: "ignore", stdout: "ignore", stderr: "pipe", timeout: 5000, killSignal: "SIGKILL" });
    return result.exitCode === 2 && result.stderr.toString().startsWith("pty-sidecar: usage:");
  } catch {
    return false;
  }
}

/** What an executable is for: `elf-<cpu>`, or `macho-<cpu>` for every Mach-O slice. */
export function architectures(path: string): string[] {
  const bytes = readFileSync(path);
  if (bytes.length < 64) return ["unknown"];
  if (bytes.readUInt32BE(0) === 0x7f454c46) return [`elf-${({ 0x3e: "x86_64", 0xb7: "aarch64" } as Record<number, string>)[bytes.readUInt16LE(18)] ?? "unknown"}`];
  const cpu = (value: number) => `macho-${({ 0x01000007: "x86_64", 0x0100000c: "aarch64" } as Record<number, string>)[value] ?? "unknown"}`;
  if (bytes.readUInt32BE(0) === 0xcafebabe) return Array.from({ length: Math.min(bytes.readUInt32BE(4), Math.floor((bytes.length - 8) / 20)) }, (_, i) => cpu(bytes.readUInt32BE(8 + i * 20)));
  if (bytes.readUInt32LE(0) === 0xfeedfacf) return [cpu(bytes.readUInt32LE(4))];
  return ["unknown"];
}

/** What `architectures` says of a working build for these Rust targets. */
export const expectedArchitectures = (targets: string[]): string[] =>
  targets.map((target) => `${target.includes("-apple-") ? "macho" : "elf"}-${target.split("-")[0]}`).sort();

function build(asset: string, out: string): void {
  const targets = ASSETS[asset];
  if (!targets) throw new Error(`Unknown asset ${asset}; one of ${Object.keys(ASSETS).join(", ")}`);
  mkdirSync(out, { recursive: true });
  const built = targets.map((target) => {
    command(["rustup", "target", "add", target]);
    command(["cargo", "build", "--release", "--locked", "--target", target, "--manifest-path", join(CRATE, "Cargo.toml")]);
    const targetDir = process.env["CARGO_TARGET_DIR"] ? resolve(process.env["CARGO_TARGET_DIR"]) : join(root, CRATE, "target");
    return join(targetDir, target, "release", NAME);
  });
  const file = join(out, `${NAME}-${asset}`);
  if (built.length > 1) {
    command(["lipo", "-create", "-output", file, ...built]);
    // each slice keeps the linker's ad-hoc signature; one over the whole file is what Apple silicon checks
    command(["codesign", "--force", "--sign", "-", file]);
  } else {
    writeFileSync(file, readFileSync(built[0]!));
  }
  chmodSync(file, 0o755);
  const want = expectedArchitectures(targets);
  const have = architectures(file).sort();
  if (JSON.stringify(have) !== JSON.stringify(want)) throw new Error(`${file} is for ${have.join("+")}, not ${want.join("+")}`);
  if (!runsHere(file)) throw new Error(`${file} does not run here as the PTY host`);
  console.log(`${file} ${have.join("+")} sha256:${sha256(readFileSync(file))}`);
}

function manifest(dir: string): void {
  const crate = crateTree();
  if (!crate) throw new Error(`${CRATE} has no git tree here`);
  const assets: Manifest["assets"] = {};
  const sums: string[] = [];
  for (const asset of Object.keys(ASSETS)) {
    const file = `${NAME}-${asset}`;
    const digest = sha256(readFileSync(join(dir, file)));
    sums.push(`${digest}  ${file}`);
    for (const [platform, runs] of Object.entries(PLATFORM_ASSET)) if (runs === asset) assets[platform] = { file, sha256: digest };
  }
  const extra = readdirSync(dir).filter((name) => name !== MANIFEST && name !== "SHA256SUMS" && !sums.some((line) => line.endsWith(`  ${name}`)));
  if (extra.length > 0) throw new Error(`Unexpected files in ${dir}: ${extra.join(", ")}`);
  const result: Manifest = { version: packageVersion(), crate, assets };
  writeFileSync(join(dir, MANIFEST), `${JSON.stringify(result, null, 2)}\n`);
  writeFileSync(join(dir, "SHA256SUMS"), `${sums.join("\n")}\n`);
  console.log(JSON.stringify(result, null, 2));
}

async function download(url: string): Promise<Uint8Array> {
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

/** What `install` did, in one line; `ok` false when this checkout has no Rust host from it. */
export async function install(options: { releases?: string; target?: string; platform?: string } = {}): Promise<{ ok: boolean; message: string }> {
  const platform = options.platform ?? `${process.platform}-${process.arch}`;
  const target = options.target ?? INSTALLED;
  const asset = PLATFORM_ASSET[platform];
  if (!asset) return { ok: false, message: `no Rust PTY host for ${platform}` };
  const crate = crateTree();
  if (!crate) return { ok: false, message: "not a git checkout, so the release's host cannot be matched to these sources" };
  const version = packageVersion();
  const base = `${(options.releases ?? process.env["OVIS_PTY_SIDECAR_RELEASES"] ?? RELEASES).replace(/\/$/, "")}/v${version}`;
  let found: Manifest;
  try {
    found = JSON.parse(new TextDecoder().decode(await download(`${base}/${MANIFEST}`))) as Manifest;
  } catch (error) {
    return { ok: false, message: `release v${version} has no Rust PTY host (${error instanceof Error ? error.message : String(error)})` };
  }
  if (found.crate !== crate) return { ok: false, message: `release v${version}'s host was built from other ${CRATE} sources than this checkout's` };
  const entry = found.assets?.[platform];
  if (!entry || !/^[0-9a-f]{64}$/.test(entry.sha256) || entry.file !== `${NAME}-${asset}`) return { ok: false, message: `release v${version}'s manifest names no host for ${platform}` };
  if (existsSync(target) && sha256(readFileSync(target)) === entry.sha256 && runsHere(target)) return { ok: true, message: `Rust PTY host v${version} already installed at ${target}` };
  let bytes: Uint8Array;
  try {
    bytes = await download(`${base}/${entry.file}`);
  } catch (error) {
    return { ok: false, message: `could not download ${entry.file} (${error instanceof Error ? error.message : String(error)})` };
  }
  const digest = sha256(bytes);
  if (digest !== entry.sha256) return { ok: false, message: `${entry.file} does not match its SHA-256 in release v${version}'s manifest (got ${digest}); nothing was installed` };
  mkdirSync(join(target, ".."), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  try {
    writeFileSync(temporary, bytes, { mode: 0o755 });
    chmodSync(temporary, 0o755);
    if (!runsHere(temporary)) return { ok: false, message: `${entry.file} does not run on this PC; nothing was installed` };
    renameSync(temporary, target);
  } finally {
    rmSync(temporary, { force: true });
  }
  return { ok: true, message: `installed the Rust PTY host of release v${version} (sha256 ${digest}) at ${target}` };
}

if (import.meta.main) {
  const [verb, ...rest] = process.argv.slice(2);
  if (verb === "build" && rest.length === 2) build(rest[0]!, resolve(rest[1]!));
  else if (verb === "manifest" && rest.length === 1) manifest(resolve(rest[0]!));
  else if (verb === "install" && (rest.length === 0 || (rest.length === 1 && rest[0] === "--strict"))) {
    const result = await install();
    if (result.ok) console.log(`Ovis: ${result.message}`);
    else console.log(`Ovis: ${result.message}; terminals use the Node PTY sidecar`);
    if (!result.ok && rest[0] === "--strict") process.exit(1);
  } else {
    console.error("Usage: bun scripts/pty-sidecar.ts build <linux-x64|linux-arm64|darwin-universal> <dir> | manifest <dir> | install [--strict]");
    process.exit(2);
  }
}
