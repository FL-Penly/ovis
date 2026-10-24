// Downstream (FL-Penly/ovis, DOWNSTREAM.md): the Source Control panel's git (git-panel.ts) and routes (git-panel-routes.ts).
import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GitBranch, GitLog, GitStatus } from "../shared/git-panel.ts";
import { checkedBranch, checkedPath, parseLog, parseStatus } from "./git-panel.ts";
import { handleGitRequest } from "./git-panel-routes.ts";
import * as paneContextModule from "./pane-context.ts";

describe("parseStatus", () => {
  it("reads the branch, its upstream, and each side of each change", () => {
    const output = [
      "# branch.oid 1234abcd", "# branch.head main", "# branch.upstream origin/main", "# branch.ab +2 -1",
      "1 M. N... 100644 100644 100644 aaa bbb staged.ts",
      "1 .M N... 100644 100644 100644 aaa bbb changed.ts",
      "1 MM N... 100644 100644 100644 aaa bbb both sides.ts",
      "2 R. N... 100644 100644 100644 aaa bbb R100 new name.ts", "old name.ts",
      "u UU N... 100644 100644 100644 100644 aaa bbb ccc conflict.ts",
      "? new file.txt", "",
    ].join("\0");
    expect(parseStatus("/repo", output)).toEqual({
      root: "/repo", branch: "main", head: "1234abcd", upstream: "origin/main", ahead: 2, behind: 1, truncated: false,
      staged: [
        { path: "staged.ts", old_path: null, kind: "M" },
        { path: "both sides.ts", old_path: null, kind: "M" },
        { path: "new name.ts", old_path: "old name.ts", kind: "R" },
      ],
      changes: [
        { path: "changed.ts", old_path: null, kind: "M" },
        { path: "both sides.ts", old_path: null, kind: "M" },
        { path: "new file.txt", old_path: null, kind: "?" },
      ],
      conflicts: [{ path: "conflict.ts", old_path: null, kind: "U" }],
    });
  });

  it("says when there is no commit yet or HEAD is detached, and when it cut the list", () => {
    const status = parseStatus("/repo", ["# branch.oid (initial)", "# branch.head (detached)", "? a", "? b", "? c", ""].join("\0"), 2);
    expect([status.head, status.branch, status.changes.length, status.truncated]).toEqual([null, null, 2, true]);
  });
});

describe("parseLog", () => {
  it("reads hashes, parents, refs and a subject that holds the field separator", () => {
    const record = (fields: string[]) => `${fields.join("\x1f")}\x1e`;
    const commits = parseLog(`${record(["c2", "c1 m1", "HEAD -> main, origin/main, tag: v1", "Ann", "1700000000", "merge\x1fit"])}\n${record(["c1", "", "", "Bo", "1600000000", "root"])}`);
    expect(commits).toEqual([
      { hash: "c2", parents: ["c1", "m1"], refs: ["HEAD -> main", "origin/main", "tag: v1"], author: "Ann", time: 1700000000, subject: "merge\x1fit" },
      { hash: "c1", parents: [], refs: [], author: "Bo", time: 1600000000, subject: "root" },
    ]);
  });
});

describe("checks before git", () => {
  it("takes relative paths only", () => {
    expect(checkedPath("src/a b.ts")).toBe("src/a b.ts");
    for (const bad of ["", "/etc/passwd", "../x", "a/../../x", "C:\\x", "a\0b", 3]) expect(() => checkedPath(bad)).toThrow();
  });

  it("takes branch names git takes, never an option", () => {
    expect(checkedBranch("feat/x-1")).toBe("feat/x-1");
    for (const bad of ["", "-f", "--force", "a b", "a..b", "a~1", "a:b", "x.lock", "a/", "a@{1}"]) expect(() => checkedBranch(bad)).toThrow();
  });
});

describe("routes, on a real repository", () => {
  let root: string;
  let repo: string;
  let remote: string;
  const git = (cwd: string, ...args: string[]) => {
    const run = Bun.spawnSync(["git", "-C", cwd, ...args], { env: { ...process.env, GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@t" } });
    if (run.exitCode !== 0) throw new Error(run.stderr.toString());
    return run.stdout.toString().trim();
  };
  const get = async <T,>(op: string, query = "") => {
    const response = await handleGitRequest(new Request(`http://x/api/pane/git/${op}?pane_id=p${query}`), new URL(`http://x/api/pane/git/${op}?pane_id=p${query}`), `/api/pane/git/${op}`);
    return { status: response!.status, body: await response!.json() as T };
  };
  const post = async (op: string, body: Record<string, unknown> = {}) => {
    const request = new Request(`http://x/api/pane/git/${op}`, { method: "POST", body: JSON.stringify({ pane_id: "p", ...body }), headers: { "content-type": "application/json" } });
    const response = await handleGitRequest(request, new URL(request.url), `/api/pane/git/${op}`);
    return { status: response!.status, body: await response!.json() as { output?: string; error?: { code: string; message: string } } };
  };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "ovis-git-panel-"));
    remote = join(root, "remote.git");
    repo = join(root, "repo");
    git(root, "init", "-q", "--bare", "-b", "main", remote);
    git(root, "init", "-q", "-b", "main", repo);
    for (const [key, value] of [["user.name", "T"], ["user.email", "t@t"], ["commit.gpgsign", "false"]]) git(repo, "config", key!, value!);
    git(repo, "remote", "add", "origin", remote);
    writeFileSync(join(repo, "a.txt"), "one\n");
    git(repo, "add", "a.txt");
    git(repo, "commit", "-q", "-m", "first");
    spyOn(paneContextModule, "paneContext").mockResolvedValue({ agent: null, cwd: repo, pane: {} as never });
  });

  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it("stages, unstages, commits, publishes, and reads the log and branches", async () => {
    writeFileSync(join(repo, "a.txt"), "two\n");
    writeFileSync(join(repo, "b.txt"), "new\n");
    let status = (await get<GitStatus>("status")).body;
    expect(status.changes.map((change) => `${change.kind} ${change.path}`)).toEqual(["M a.txt", "? b.txt"]);

    expect((await post("stage", { paths: ["b.txt"] })).status).toBe(200);
    status = (await get<GitStatus>("status")).body;
    expect([status.staged.map((change) => change.path), status.changes.map((change) => change.path)]).toEqual([["b.txt"], ["a.txt"]]);
    await post("unstage", { paths: ["b.txt"] });
    expect((await get<GitStatus>("status")).body.staged).toEqual([]);

    // nothing staged: every change goes in, as VS Code's smart commit
    const committed = await post("commit", { message: "second", all: true });
    expect(committed.status).toBe(200);
    status = (await get<GitStatus>("status")).body;
    expect([status.staged, status.changes, status.upstream]).toEqual([[], [], null]);

    const pushed = await post("push");
    expect(pushed.status).toBe(200);
    status = (await get<GitStatus>("status")).body;
    expect([status.upstream, status.ahead, status.behind]).toEqual(["origin/main", 0, 0]);
    expect(git(remote, "log", "--format=%s", "main")).toBe("second\nfirst");

    const log = (await get<GitLog>("log", "&limit=1")).body;
    expect([log.commits.map((commit) => commit.subject), log.more]).toEqual([["second"], true]);
    expect(log.commits[0]!.refs).toContain("HEAD -> main");

    expect((await post("checkout", { branch: "feat/x", create: true })).status).toBe(200);
    const branches = (await get<GitBranch[]>("branches")).body;
    expect(branches.filter((branch) => !branch.remote).map((branch) => [branch.name, branch.current])).toEqual([["feat/x", true], ["main", false]]);
    expect(branches.some((branch) => branch.remote && branch.name === "origin/main")).toBe(true);
  });

  it("discards a tracked change and deletes an untracked file, after which both are gone", async () => {
    writeFileSync(join(repo, "a.txt"), "changed\n");
    writeFileSync(join(repo, "junk.txt"), "x\n");
    expect((await post("discard", { paths: ["a.txt"], untracked: ["junk.txt"] })).status).toBe(200);
    expect(readFileSync(join(repo, "a.txt"), "utf8")).toBe("one\n");
    expect(existsSync(join(repo, "junk.txt"))).toBe(false);
  });

  it("answers git's own words when git refuses, and refuses bad input before git", async () => {
    const empty = await post("commit", { message: "nothing here" });
    expect([empty.status, empty.body.error?.code]).toEqual([409, "git_failed"]);
    expect(empty.body.error?.message).toContain("nothing to commit");
    expect((await post("stage", { paths: ["../outside"] })).body.error?.code).toBe("invalid_path");
    expect((await post("checkout", { branch: "--orphan" })).body.error?.code).toBe("invalid_branch");
    expect((await post("commit", { message: " " })).body.error?.code).toBe("empty_message");
    expect((await get("stage")).status).toBe(400);
    expect(await handleGitRequest(new Request("http://x/api/pane/git/rm"), new URL("http://x/api/pane/git/rm"), "/api/pane/git/rm")).toBeNull();
  });

  it("says when the pane's folder is not a repository", async () => {
    spyOn(paneContextModule, "paneContext").mockResolvedValue({ agent: null, cwd: root, pane: {} as never });
    expect((await get<{ error: { code: string } }>("status")).body.error.code).toBe("not_a_repository");
  });
});
