/**
 * Downstream (FL-Penly/ovis, DOWNSTREAM.md): the Source Control panel's contract, between
 * server/git-panel-routes.ts and src/components/GitPanel.tsx. Every route is under /api/pane/git/
 * and names the pane whose folder's repository it works on; mutations are POST with a JSON body.
 */

/** git's letter for how a file changed on one side (index or working tree), `?` untracked, `U` unmerged. */
export type GitChangeKind = "M" | "A" | "D" | "R" | "C" | "T" | "U" | "?";

export interface GitChange {
  /** relative to the repository root, forward slashes, never quoted */
  path: string;
  /** where a renamed or copied file came from */
  old_path: string | null;
  kind: GitChangeKind;
}

/** GET /api/pane/git/status?pane_id= */
export interface GitStatus {
  /** the working tree's top folder, absolute */
  root: string;
  /** the checked-out branch; null on a detached HEAD */
  branch: string | null;
  /** HEAD's commit; null before the first commit */
  head: string | null;
  /** the branch's upstream (`origin/main`); null when it has none */
  upstream: string | null;
  /** commits HEAD is ahead of / behind its upstream */
  ahead: number;
  behind: number;
  /** in the index, to be committed */
  staged: GitChange[];
  /** in the working tree only, untracked files included */
  changes: GitChange[];
  /** unmerged paths of a merge, rebase or cherry-pick */
  conflicts: GitChange[];
  /** git listed more than the panel shows */
  truncated: boolean;
}

/** GET /api/pane/git/log?pane_id=&limit=&skip= : HEAD's history and its upstream's, newest first. */
export interface GitCommit {
  hash: string;
  parents: string[];
  /** the refs pointing here, as `git log --decorate` names them (`HEAD -> main`, `origin/main`, `tag: v1`) */
  refs: string[];
  author: string;
  /** seconds since the epoch */
  time: number;
  subject: string;
}

export interface GitLog {
  commits: GitCommit[];
  /** more history past these */
  more: boolean;
}

/** GET /api/pane/git/branches?pane_id= */
export interface GitBranch {
  /** `main`, or `origin/main` for a remote one */
  name: string;
  remote: boolean;
  current: boolean;
  upstream: string | null;
  /** seconds since the epoch of its newest commit */
  time: number;
}

/** POST /api/pane/git/{stage,unstage,discard,commit,push,pull,fetch,checkout}: what git printed, cut short. */
export interface GitDone {
  output: string;
}

/** The error a failed git command answers with (409): its own words, cut short. */
export const GIT_FAILED = "git_failed";
