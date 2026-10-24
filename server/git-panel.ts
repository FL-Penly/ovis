/**
 * Downstream (FL-Penly/ovis, DOWNSTREAM.md): the git behind the Source Control panel. Every command
 * runs as an argv (no shell) in the repository of a pane's folder, with the environment
 * server/repo-diff.ts gives git and nothing that could wait on a person: no terminal prompt, no
 * editor, ssh in batch mode. Unlike repo-diff's reader it keeps git's own words, since a refused
 * commit hook or push is what the user needs to read. Paths are checked before they reach git and
 * always follow `--`.
 */
import type { GitBranch, GitChange, GitChangeKind, GitCommit, GitLog, GitStatus } from "../shared/git-panel.ts";

/** local commands (status, stage, commit with its hooks) and the ones over the network */
export const LOCAL_DEADLINE_MS = 20_000;
/** under the server's 60 s for an authenticated request */
export const NETWORK_DEADLINE_MS = 55_000;
const MAX_STDOUT = 8 * 1024 * 1024;
const MAX_MESSAGE = 4000;
export const MAX_CHANGES = 3000;

export class GitPanelError extends Error {
  constructor(readonly code: string, message: string, readonly status = 409) { super(message); }
}

export interface GitRun { code: number; stdout: string; stderr: string }

function gitEnvironment(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value === undefined || ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR", "GIT_EXTERNAL_DIFF", "GIT_PAGER"].includes(name)) continue;
    env[name] = value;
  }
  return {
    ...env,
    GIT_TERMINAL_PROMPT: "0",
    GCM_INTERACTIVE: "never",
    GIT_EDITOR: "true",
    GIT_SEQUENCE_EDITOR: "true",
    GIT_MERGE_AUTOEDIT: "no",
    // a host key or passphrase prompt would wait for nobody; the user's own ssh command is kept
    GIT_SSH_COMMAND: env.GIT_SSH_COMMAND ?? "ssh -o BatchMode=yes",
    LC_ALL: "C",
  };
}

/** One git in `cwd`, killed at the deadline. */
export async function runGit(cwd: string, args: string[], deadlineMs = LOCAL_DEADLINE_MS, git = "git"): Promise<GitRun> {
  const argv = [git, "--no-pager", "--literal-pathspecs", "-c", "core.quotePath=false", "-c", "color.ui=never", "-C", cwd, ...args];
  let proc: Bun.Subprocess<"ignore", "pipe", "pipe">;
  try {
    proc = Bun.spawn(argv, { stdin: "ignore", stdout: "pipe", stderr: "pipe", env: gitEnvironment() });
  } catch {
    throw new GitPanelError("git_unavailable", "git could not be started on this PC", 503);
  }
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; proc.kill("SIGKILL"); }, deadlineMs);
  try {
    const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).arrayBuffer(), new Response(proc.stderr).text(), proc.exited]);
    if (timedOut) throw new GitPanelError("git_timeout", `git ${args[0]} did not finish in ${Math.round(deadlineMs / 1000)} s`, 504);
    if (stdout.byteLength > MAX_STDOUT) throw new GitPanelError("too_large", "git printed more than the panel reads", 413);
    return { code, stdout: Buffer.from(stdout).toString("utf8"), stderr };
  } finally {
    clearTimeout(timer);
  }
}

/** What git said, for the person: its error lines first, cut to a readable length. */
export function gitMessage(run: GitRun): string {
  const text = `${run.stderr}\n${run.stdout}`.replace(/\r/g, "").split("\n").map((line) => line.trimEnd()).filter(Boolean).join("\n");
  return text.length > MAX_MESSAGE ? `${text.slice(0, MAX_MESSAGE)}…` : text || `git exited with ${run.code}`;
}

/** Run, and turn a non-zero exit into the 409 that carries git's words. */
export async function mustGit(cwd: string, args: string[], deadlineMs = LOCAL_DEADLINE_MS): Promise<GitRun> {
  const run = await runGit(cwd, args, deadlineMs);
  if (run.code !== 0) throw new GitPanelError("git_failed", gitMessage(run));
  return run;
}

export async function repositoryRoot(cwd: string): Promise<string> {
  const run = await runGit(cwd, ["rev-parse", "--show-toplevel"]);
  const root = run.stdout.replace(/\r?\n$/, "");
  if (run.code !== 0 || root === "") throw new GitPanelError("not_a_repository", "this pane's folder is not inside a git working tree");
  return root;
}

/** A path as git names it: relative to the root, no `..`, no NUL, forward slashes. */
export function checkedPath(value: unknown): string {
  if (typeof value !== "string" || value === "" || value.length > 4096 || value.includes("\0") || value.startsWith("/") || /^[A-Za-z]:/.test(value)
    || value.split("/").some((part) => part === "..")) throw new GitPanelError("invalid_path", "a path must be relative to the repository, without ..", 400);
  return value;
}

/** A branch name git would take, never one that reads as an option. */
export function checkedBranch(value: unknown): string {
  if (typeof value !== "string" || value === "" || value.length > 255 || value.startsWith("-") || /[\s~^:?*[\\\0]|\.\.|@\{|\/\/|\/$|\.lock$|^\/|\.$/.test(value))
    throw new GitPanelError("invalid_branch", "that is not a branch name git takes", 400);
  return value;
}

const KINDS = new Set<GitChangeKind>(["M", "A", "D", "R", "C", "T", "U"]);
const kindOf = (letter: string | undefined): GitChangeKind | null => letter !== undefined && KINDS.has(letter as GitChangeKind) ? letter as GitChangeKind : null;

/** `git status --porcelain=v2 -z --branch --untracked-files=all`, read. */
export function parseStatus(root: string, output: string, limit = MAX_CHANGES): GitStatus {
  const status: GitStatus = { root, branch: null, head: null, upstream: null, ahead: 0, behind: 0, staged: [], changes: [], conflicts: [], truncated: false };
  const records = output.split("\0");
  const push = (list: GitChange[], change: GitChange) => { if (list.length < limit) list.push(change); else status.truncated = true; };
  for (let index = 0; index < records.length; index++) {
    const record = records[index]!;
    if (record === "") continue;
    if (record.startsWith("# ")) {
      const [, key, ...rest] = record.split(" ");
      const value = rest.join(" ");
      if (key === "branch.oid") status.head = value === "(initial)" ? null : value;
      else if (key === "branch.head") status.branch = value === "(detached)" ? null : value;
      else if (key === "branch.upstream") status.upstream = value;
      else if (key === "branch.ab") {
        const match = /^\+(\d+) -(\d+)$/.exec(value);
        if (match) { status.ahead = Number(match[1]); status.behind = Number(match[2]); }
      }
      continue;
    }
    const type = record[0];
    if (type === "?") { push(status.changes, { path: record.slice(2), old_path: null, kind: "?" }); continue; }
    if (type === "1" || type === "2") {
      // 1 XY sub mH mI mW hH hI path; 2 adds a score before the path and the old path as the next record
      const fields = record.split(" ");
      const xy = fields[1] ?? "..";
      const path = fields.slice(type === "1" ? 8 : 9).join(" ");
      const oldPath = type === "2" ? records[++index] ?? null : null;
      const staged = kindOf(xy[0]);
      const changed = kindOf(xy[1]);
      if (staged) push(status.staged, { path, old_path: staged === "R" || staged === "C" ? oldPath : null, kind: staged });
      if (changed) push(status.changes, { path, old_path: null, kind: changed });
      continue;
    }
    if (type === "u") push(status.conflicts, { path: record.split(" ").slice(10).join(" "), old_path: null, kind: "U" });
  }
  return status;
}

const FIELD = "\x1f";
const RECORD = "\x1e";
export const LOG_FORMAT = ["%H", "%P", "%D", "%an", "%at", "%s"].join("%x1f") + "%x1e";

/** `git log --format=LOG_FORMAT`, read. */
export function parseLog(output: string): GitCommit[] {
  return output.split(RECORD).map((record) => record.replace(/^\n/, "")).filter(Boolean).map((record) => {
    const [hash = "", parents = "", refs = "", author = "", time = "0", ...subject] = record.split(FIELD);
    return {
      hash,
      parents: parents.split(" ").filter(Boolean),
      refs: refs.split(", ").map((ref) => ref.trim()).filter(Boolean),
      author,
      time: Number(time) || 0,
      subject: subject.join(FIELD),
    };
  });
}

/** `git for-each-ref --format=BRANCH_FORMAT refs/heads refs/remotes`, read; remote HEAD aliases left out. */
export const BRANCH_FORMAT = ["%(refname)", "%(refname:short)", "%(upstream:short)", "%(committerdate:unix)", "%(HEAD)"].join("%1f");
export function parseBranches(output: string): GitBranch[] {
  return output.split("\n").filter(Boolean).flatMap((line) => {
    const [ref = "", name = "", upstream = "", time = "0", head = ""] = line.split(FIELD);
    if (ref.endsWith("/HEAD")) return [];
    return [{ name, remote: ref.startsWith("refs/remotes/"), current: head === "*", upstream: upstream || null, time: Number(time) || 0 }];
  }).sort((left, right) => Number(right.current) - Number(left.current) || Number(left.remote) - Number(right.remote) || right.time - left.time);
}

export async function gitStatus(root: string): Promise<GitStatus> {
  const run = await mustGit(root, ["status", "--porcelain=v2", "-z", "--branch", "--untracked-files=all"]);
  return parseStatus(root, run.stdout);
}

export async function gitLog(root: string, limit: number, skip: number, upstream: string | null): Promise<GitLog> {
  const head = await runGit(root, ["rev-parse", "--verify", "--quiet", "HEAD"]);
  if (head.code !== 0) return { commits: [], more: false };
  const run = await mustGit(root, ["log", "--topo-order", `--format=${LOG_FORMAT}`, `--max-count=${limit + 1}`, `--skip=${skip}`, "HEAD", ...(upstream ? [upstream] : []), "--"]);
  const commits = parseLog(run.stdout);
  return { commits: commits.slice(0, limit), more: commits.length > limit };
}
