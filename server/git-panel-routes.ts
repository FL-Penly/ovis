/**
 * Downstream (FL-Penly/ovis, DOWNSTREAM.md): /api/pane/git/<op>, the Source Control panel's routes
 * (shared/git-panel.ts). Reads are GET, changes POST with a JSON body (index.ts already refuses a
 * cross-site POST and a watch-only device's). The repository is the one around the pane's folder.
 */
import type { GitDone } from "../shared/git-panel.ts";
import { HerdrError } from "./herdr/client.ts";
import { badRequest, errorResponse, jsonResponse, readJsonObject, setRequestRoute } from "./http.ts";
import { paneContext } from "./pane-context.ts";
import { BRANCH_FORMAT, checkedBranch, checkedPath, gitLog, gitMessage, GitPanelError, gitStatus, mustGit, NETWORK_DEADLINE_MS, parseBranches, repositoryRoot, runGit } from "./git-panel.ts";

const PREFIX = "/api/pane/git/";
const READS = new Set(["status", "log", "branches"]);
const WRITES = new Set(["stage", "unstage", "discard", "commit", "push", "pull", "fetch", "checkout"]);
const MAX_PATHS = 1000;

const done = (output: string): Response => jsonResponse({ output: output.trim().slice(0, 4000) } satisfies GitDone);

function paths(value: unknown): string[] | null {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_PATHS) throw new GitPanelError("invalid_paths", `paths is a list of 1 to ${MAX_PATHS} files`, 400);
  return value.map(checkedPath);
}

async function write(op: string, root: string, body: Record<string, unknown>): Promise<Response> {
  switch (op) {
    case "stage": {
      const files = paths(body.paths);
      return done((await mustGit(root, ["add", "-A", ...(files ? ["--", ...files] : [])])).stdout);
    }
    case "unstage": {
      const files = paths(body.paths);
      const born = (await runGit(root, ["rev-parse", "--verify", "--quiet", "HEAD"])).code === 0;
      // before the first commit there is no HEAD to reset to: the files leave the index instead
      const args = born ? ["reset", "-q", ...(files ? ["--", ...files] : [])] : ["rm", "--cached", "-r", "-q", "--", ...(files ?? ["."])];
      return done((await mustGit(root, args)).stdout);
    }
    case "discard": {
      const tracked = paths(body.paths) ?? [];
      const untracked = paths(body.untracked) ?? [];
      if (tracked.length === 0 && untracked.length === 0) return badRequest("invalid_paths", "name the files to discard");
      if (tracked.length > 0) await mustGit(root, ["restore", "--worktree", "--", ...tracked]);
      if (untracked.length > 0) await mustGit(root, ["clean", "-f", "-q", "--", ...untracked]);
      return done("");
    }
    case "commit": {
      const message = typeof body.message === "string" ? body.message.trim() : "";
      const amend = body.amend === true;
      if (message === "" && !amend) return badRequest("empty_message", "a commit needs a message");
      if (message.length > 20_000) return badRequest("message_too_long", "the commit message is too long");
      // VS Code's smart commit: with nothing staged, every change goes in
      if (body.all === true) await mustGit(root, ["add", "-A"]);
      return done((await mustGit(root, ["commit", "--cleanup=strip", ...(amend ? ["--amend"] : []), ...(message ? ["-m", message] : ["--no-edit"])])).stdout);
    }
    case "push": {
      const status = await gitStatus(root);
      if (status.branch === null) throw new GitPanelError("detached_head", "HEAD is detached: check out a branch to push");
      // a branch with no upstream is published to origin, as VS Code's Publish Branch
      const args = status.upstream ? ["push"] : ["push", "--set-upstream", "origin", status.branch];
      const run = await mustGit(root, args, NETWORK_DEADLINE_MS);
      return done(gitMessage(run));
    }
    case "pull": return done(gitMessage(await mustGit(root, ["pull", "--no-edit"], NETWORK_DEADLINE_MS)));
    case "fetch": return done(gitMessage(await mustGit(root, ["fetch", "--prune"], NETWORK_DEADLINE_MS)));
    case "checkout": {
      const branch = checkedBranch(body.branch);
      if (body.create === true) return done(gitMessage(await mustGit(root, ["switch", "-c", branch])));
      // a remote branch is checked out as the local branch tracking it
      const remote = body.remote === true ? /^[^/]+\/(.+)$/.exec(branch)?.[1] : undefined;
      return done(gitMessage(await mustGit(root, remote ? ["switch", "--track", "-c", checkedBranch(remote), branch] : ["switch", branch])));
    }
  }
  return badRequest("unknown_op", "no such git operation");
}

async function read(op: string, root: string, url: URL): Promise<Response> {
  if (op === "status") return jsonResponse(await gitStatus(root));
  if (op === "branches") return jsonResponse(parseBranches((await mustGit(root, ["for-each-ref", `--format=${BRANCH_FORMAT}`, "refs/heads", "refs/remotes"])).stdout));
  const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit")) || 200));
  const skip = Math.max(0, Number(url.searchParams.get("skip")) || 0);
  const upstream = (await runGit(root, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"])).stdout.trim();
  return jsonResponse(await gitLog(root, limit, skip, upstream && !upstream.startsWith("-") ? upstream : null));
}

/** The answer for /api/pane/git/<op>, or null when the path is not one. */
export async function handleGitRequest(request: Request, url: URL, pathname: string): Promise<Response | null> {
  if (!pathname.startsWith(PREFIX)) return null;
  const op = pathname.slice(PREFIX.length);
  if (!READS.has(op) && !WRITES.has(op)) return null;
  setRequestRoute(`${PREFIX}${op}`);
  const writing = WRITES.has(op);
  if (request.method !== (writing ? "POST" : "GET")) return badRequest("method_not_allowed", `use ${writing ? "POST" : "GET"}`);
  try {
    const body = writing ? await readJsonObject<Record<string, unknown>>(request) : {};
    if (body instanceof Response) return body;
    const paneId = writing ? body.pane_id : url.searchParams.get("pane_id");
    if (typeof paneId !== "string" || paneId === "") return badRequest("missing_pane_id", "pane_id is required");
    const root = await repositoryRoot((await paneContext(paneId)).cwd);
    return writing ? await write(op, root, body) : await read(op, root, url);
  } catch (error) {
    if (error instanceof GitPanelError) return jsonResponse({ error: { code: error.code, message: error.message } }, error.status);
    if (error instanceof HerdrError) return errorResponse(error);
    return errorResponse(error);
  }
}
