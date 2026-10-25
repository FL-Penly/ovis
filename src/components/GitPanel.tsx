/**
 * Downstream (FL-Penly/ovis, DOWNSTREAM.md): a Source Control panel after VS Code's, for the
 * repository around the open pane's folder. Its head names the branch (a press lists the others)
 * and syncs; then the commit message and Commit (⌘↵; with nothing staged every change goes in, as
 * VS Code's smart commit); then Merge Changes, Staged Changes and Changes, each file with its
 * stage, unstage or discard; then the commit graph, where a commit opens its files. A file opens
 * in the app's own diff viewer. It reads the status every few seconds while it is shown.
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { trimPatchContext } from "@pierre/diffs";
import { ArrowDown, ArrowUp, Check, ChevronDown, ChevronRight, CloudDownload, CloudUpload, GitBranch, GitCommitHorizontal, Maximize2, Minus, Plus, RefreshCw, Undo2, X } from "lucide-react";
import type { GitBranch as Branch, GitChange, GitCommit, GitStatus } from "../../shared/git-panel.ts";
import type { RepoDiffFile, RepoDiffScope } from "../../shared/protocol.ts";
import { gitApi, GitRequestError, layoutGraph, splitPath, type GraphRow } from "../lib/gitPanel.ts";
import { useT } from "../lib/i18n.ts";
import { useMachineApi } from "../lib/machineContext.tsx";
import { diffColorable, diffErrorMessage, unavailableMessage } from "../lib/repoDiff.ts";
import { useSettings } from "../lib/settings.ts";
import { FOLDED_CONTEXT_LINES } from "./RepoDiff.tsx";
import { RenderBoundary } from "./RenderBoundary.tsx";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import { RowMenu, type RowMenuItem } from "./RowMenu.tsx";
import "./GitPanel.css";

const POLL_MS = 4000;
const LOG_PAGE = 150;
const LANE_PX = 14;
const ROW_PX = 26;
const LANE_COLORS = ["#4ea1ff", "#e5534b", "#57ab5a", "#c69026", "#b083f0", "#39c5cf", "#e275ad", "#8b949e"];

export interface GitDiffRequest { scope: RepoDiffScope; base: string | null; head: string | null; path: string; oldPath: string | null }

const RepoDiff = lazy(() => import("./RepoDiff.tsx"));

/** The rows RepoDiff draws for a patch: its lines from the first hunk on, each hunk's separator two rows high, and one for the box's padding. */
export function shownRows(patch: string): number {
  const lines = patch.split("\n");
  const body = lines.slice(Math.max(0, lines.findIndex((line) => line.startsWith("@@"))));
  const hunks = body.filter((line) => line.startsWith("@@")).length;
  const drawn = body.filter((line) => line !== "" && !line.startsWith("@@") && !line.startsWith("\\")).length;
  return drawn + hunks * 2 + 1;
}

/**
 * A file's change under its row in the panel: one column, wrapped, each change with a line of
 * context, in a box as tall as the change (60% of the screen at most) that scrolls by itself. The
 * row's other button opens the full viewer.
 */
function InlineDiff({ paneId, directory, request }: { paneId: string; directory: string | null; request: GitDiffRequest }) {
  const t = useT();
  const { resolvedEntry } = useSettings();
  const { fetchRepoDiffFile } = useMachineApi();
  const [shown, setShown] = useState<{ patch: string | null; note: string | null } | null>(null);
  const { scope, base, head, path, oldPath } = request;
  useEffect(() => {
    let live = true;
    setShown(null);
    fetchRepoDiffFile({ paneId, directory, scope, base, head, comparison: null }, path, oldPath).then(
      (answer) => { if (live) setShown({ patch: answer.patch, note: unavailableMessage(t, answer) }); },
      (error: unknown) => { if (live) setShown({ patch: null, note: diffErrorMessage(t, error) }); },
    );
    return () => { live = false; };
  }, [fetchRepoDiffFile, paneId, directory, scope, base, head, path, oldPath, t]);
  if (shown === null) return <p className="git-empty git-inline-note" role="status">{t("Reading the change…")}</p>;
  if (shown.note !== null || shown.patch === null) return <p className="git-empty git-inline-note">{shown.note ?? t("No lines changed here.")}</p>;
  const rows = shownRows(trimPatchContext(shown.patch, FOLDED_CONTEXT_LINES));
  return <div className="git-inline-diff" style={{ height: `min(60vh, calc(${rows} * var(--fs-xs) * var(--lh-base)))` }}>
    <RenderBoundary resetKey={shown.patch} fallback={() => <p className="git-empty git-inline-note" role="alert">{t("This change can't be shown here.")}</p>}>
      <Suspense fallback={<p className="git-empty git-inline-note" role="status">{t("Reading the change…")}</p>}>
        <RepoDiff patch={shown.patch} style="unified" folded wrap theme={resolvedEntry.mode} colored={diffColorable(path, shown.patch)} />
      </Suspense>
    </RenderBoundary>
  </div>;
}

type Op = "stage" | "unstage" | "discard" | "commit" | "push" | "pull" | "fetch" | "checkout";
type Discard = { tracked: string[]; untracked: string[]; label: string };

export function GitPanel({ paneId, directory, onOpenDiff, onClose }: { paneId: string; directory: string | null; onOpenDiff(request: GitDiffRequest): void; onClose(): void }) {
  const t = useT();
  const api = useMachineApi();
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [busy, setBusy] = useState<Op | null>(null);
  const [note, setNote] = useState<{ text: string; failed: boolean } | null>(null);
  const [message, setMessage] = useState("");
  const [folded, setFolded] = useState<Set<string>>(new Set());
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [more, setMore] = useState(false);
  const [opened, setOpened] = useState<{ hash: string; files: RepoDiffFile[] | null; base: string | null } | null>(null);
  const [branches, setBranches] = useState<{ anchor: HTMLElement; list: Branch[] } | null>(null);
  const [commitMenu, setCommitMenu] = useState<HTMLElement | null>(null);
  const [discard, setDiscard] = useState<Discard | null>(null);
  // the one file whose change is open under its row, by where it was listed
  const [expanded, setExpanded] = useState<string | null>(null);
  const headSeen = useRef<string | null | undefined>(undefined);

  const loadLog = useCallback(async (skip: number) => {
    const log = await gitApi.log(paneId, LOG_PAGE, skip);
    setCommits((before) => skip === 0 ? log.commits : [...before, ...log.commits]);
    setMore(log.more);
  }, [paneId]);

  const refresh = useCallback(async () => {
    try {
      const next = await gitApi.status(paneId);
      setStatus(next);
      setError(null);
      // the graph is read again only when HEAD or what it is compared with moved
      const head = `${next.head}|${next.upstream}|${next.ahead}|${next.behind}`;
      if (headSeen.current !== head) { headSeen.current = head; await loadLog(0); }
    } catch (e) {
      setError(e instanceof GitRequestError ? { code: e.code, message: e.message } : { code: "failed", message: String(e) });
    }
  }, [paneId, loadLog]);

  useEffect(() => {
    headSeen.current = undefined;
    setStatus(null); setCommits([]); setOpened(null); setNote(null); setExpanded(null);
    void refresh();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const run = async (op: Op, body: Record<string, unknown> = {}, said?: string): Promise<boolean> => {
    setBusy(op); setNote(null);
    try {
      const done = await gitApi.run(op, paneId, body);
      if (said || (op === "push" || op === "pull" || op === "fetch") && done.output) setNote({ text: said ?? done.output, failed: false });
      return true;
    } catch (e) {
      setNote({ text: e instanceof Error ? e.message : String(e), failed: true });
      return false;
    } finally {
      setBusy(null);
      void refresh();
    }
  };

  const commit = async (then?: "push", amend = false) => {
    if (!status) return;
    const all = status.staged.length === 0;
    if (!amend && message.trim() === "") { setNote({ text: t("Type a commit message first"), failed: true }); return; }
    if (!amend && all && status.changes.length === 0) { setNote({ text: t("There is nothing to commit"), failed: true }); return; }
    if (await run("commit", { message, all, amend })) {
      setMessage("");
      if (then === "push") await run("push");
    }
  };

  const onMessageKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing) { event.preventDefault(); void commit(); }
  };

  const openBranches = async (anchor: HTMLElement) => {
    try { setBranches({ anchor, list: await gitApi.branches(paneId) }); }
    catch (e) { setNote({ text: e instanceof Error ? e.message : String(e), failed: true }); }
  };

  const openCommit = async (row: GraphRow) => {
    if (opened?.hash === row.commit.hash) { setOpened(null); return; }
    const base = row.commit.parents[0] ?? null;
    setOpened({ hash: row.commit.hash, files: null, base });
    if (base === null) return;
    try {
      const list = await api.fetchRepoDiffFiles({ paneId, directory, scope: "commit", base, head: row.commit.hash, comparison: null });
      setOpened((current) => current?.hash === row.commit.hash ? { ...current, files: list.files } : current);
    } catch (e) {
      setNote({ text: e instanceof Error ? e.message : String(e), failed: true });
    }
  };

  const graph = useMemo(() => layoutGraph(commits), [commits]);
  const graphWidth = useMemo(() => Math.max(1, ...graph.map((row) => row.width)), [graph]);
  const toggle = (key: string) => setFolded((before) => { const next = new Set(before); if (next.has(key)) next.delete(key); else next.add(key); return next; });

  const toggleDiff = (key: string) => setExpanded((open) => open === key ? null : key);
  const fullView = (request: GitDiffRequest) => <button type="button" className="git-icon" title={t("Open in the diff viewer")} aria-label={t("Open in the diff viewer")}
    onClick={() => onOpenDiff(request)}><Maximize2 aria-hidden="true" /></button>;

  const fileRow = (change: GitChange, side: "staged" | "changes" | "conflicts") => {
    const { name, folder } = splitPath(change.path);
    const untracked = change.kind === "?";
    const scope: RepoDiffScope = side === "staged" ? "staged" : "workspace";
    const key = `${side}:${change.path}`;
    const request: GitDiffRequest = { scope, base: null, head: null, path: change.path, oldPath: change.old_path };
    const open = expanded === key;
    return <li key={key} className={`git-file-item${open ? " is-open" : ""}`}><div className="git-file">
      <button type="button" className="git-file-main" aria-expanded={open} title={change.old_path ? `${change.old_path} → ${change.path}` : change.path}
        onClick={() => toggleDiff(key)}>
        <span className="git-file-name">{name}</span>
        {folder && <span className="git-file-folder">{folder}</span>}
      </button>
      <span className="git-file-actions">
        {fullView(request)}
        {side !== "staged" && <button type="button" className="git-icon" title={t("Discard changes")} aria-label={t("Discard changes")} disabled={busy !== null}
          onClick={() => setDiscard({ tracked: untracked ? [] : [change.path], untracked: untracked ? [change.path] : [], label: change.path })}><Undo2 aria-hidden="true" /></button>}
        {side === "staged"
          ? <button type="button" className="git-icon" title={t("Unstage")} aria-label={t("Unstage")} disabled={busy !== null} onClick={() => void run("unstage", { paths: [change.path] })}><Minus aria-hidden="true" /></button>
          : <button type="button" className="git-icon" title={t("Stage")} aria-label={t("Stage")} disabled={busy !== null} onClick={() => void run("stage", { paths: [change.path] })}><Plus aria-hidden="true" /></button>}
      </span>
      <span className={`git-kind is-${change.kind === "?" ? "untracked" : change.kind}`} title={kindWord(t, change.kind)}>{change.kind === "?" ? "U" : change.kind}</span>
    </div>{open && <InlineDiff paneId={paneId} directory={directory} request={request} />}</li>;
  };

  const section = (key: string, title: string, list: GitChange[], side: "staged" | "changes" | "conflicts", tools: ReactNode) => {
    if (list.length === 0 && side !== "changes") return null;
    const open = !folded.has(key);
    return <section className="git-section">
      <div className="git-section-head">
        <button type="button" className="git-section-toggle" aria-expanded={open} onClick={() => toggle(key)}>
          {open ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}<span>{title}</span>
        </button>
        <span className="git-section-tools">{tools}</span>
        <span className="git-count">{list.length}</span>
      </div>
      {open && <ul className="git-files">{list.map((change) => fileRow(change, side))}</ul>}
    </section>;
  };

  const branchItems = (list: Branch[]): RowMenuItem[] => [
    { id: "new-branch", label: t("Create a new branch…"), icon: Plus, run: () => {
      const name = window.prompt(t("New branch name"))?.trim();
      if (name) void run("checkout", { branch: name, create: true });
    } },
    ...list.filter((branch) => !branch.current).slice(0, 40).map((branch, index): RowMenuItem => ({
      id: `branch-${branch.name}`, label: branch.name, icon: branch.remote ? CloudDownload : GitBranch, divider: index === 0,
      hint: branch.remote ? t("remote") : undefined,
      run: () => void run("checkout", { branch: branch.name, remote: branch.remote }),
    })),
  ];

  const syncLabel = status?.upstream ? t("Pull, then push ({ahead} up, {behind} down)", { ahead: status.ahead, behind: status.behind }) : t("Publish this branch");
  const branchWord = status ? status.branch ?? (status.head ? status.head.slice(0, 8) : t("no commit yet")) : "";

  let body: ReactNode;
  if (error && !status) {
    body = <p className="git-empty">{error.code === "not_a_repository" ? t("This pane's folder is not in a git repository.") : error.message}</p>;
  } else if (!status) {
    body = <p className="git-empty">{t("Reading the repository…")}</p>;
  } else {
    const nothingStaged = status.staged.length === 0;
    body = <>
      <div className="git-commit">
        <textarea className="git-message" rows={2} value={message} onChange={(event) => setMessage(event.target.value)} onKeyDown={onMessageKey}
          placeholder={t("Message (⌘↵ to commit on \"{branch}\")", { branch: branchWord })} aria-label={t("Commit message")} />
        <div className="git-commit-buttons">
          <button type="button" className="git-commit-button" disabled={busy !== null} onClick={() => void commit()}
            title={nothingStaged ? t("Nothing is staged: every change is committed") : undefined}>
            <Check aria-hidden="true" />{busy === "commit" ? t("Committing…") : nothingStaged && status.changes.length > 0 ? t("Commit all") : t("Commit")}
          </button>
          <button type="button" className="git-commit-more" aria-label={t("More commit actions")} aria-haspopup="menu" disabled={busy !== null}
            onClick={(event) => setCommitMenu(event.currentTarget)}><ChevronDown aria-hidden="true" /></button>
        </div>
      </div>
      {section("conflicts", t("Merge Changes"), status.conflicts, "conflicts", null)}
      {section("staged", t("Staged Changes"), status.staged, "staged",
        <button type="button" className="git-icon" title={t("Unstage all")} aria-label={t("Unstage all")} disabled={busy !== null} onClick={() => void run("unstage")}><Minus aria-hidden="true" /></button>)}
      {section("changes", t("Unstaged Changes"), status.changes, "changes", status.changes.length > 0 && <>
        <button type="button" className="git-icon" title={t("Discard all changes")} aria-label={t("Discard all changes")} disabled={busy !== null}
          onClick={() => setDiscard({ tracked: status.changes.filter((c) => c.kind !== "?").map((c) => c.path), untracked: status.changes.filter((c) => c.kind === "?").map((c) => c.path), label: t("{count} files", { count: status.changes.length }) })}><Undo2 aria-hidden="true" /></button>
        <button type="button" className="git-icon" title={t("Stage all")} aria-label={t("Stage all")} disabled={busy !== null} onClick={() => void run("stage")}><Plus aria-hidden="true" /></button>
      </>)}
      {status.truncated && <p className="git-empty">{t("Only the first files are listed.")}</p>}
      <section className="git-section git-graph-section">
        <div className="git-section-head">
          <button type="button" className="git-section-toggle" aria-expanded={!folded.has("graph")} onClick={() => toggle("graph")}>
            {folded.has("graph") ? <ChevronRight aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}<span>{t("Graph")}</span>
          </button>
        </div>
        {!folded.has("graph") && <div className="git-graph">
          {graph.length === 0 && <p className="git-empty">{t("This repository has no commits yet")}</p>}
          {graph.map((row) => <div key={row.commit.hash}>
            <button type="button" className={`git-commit-row${opened?.hash === row.commit.hash ? " is-open" : ""}`} onClick={() => void openCommit(row)}
              title={`${row.commit.hash.slice(0, 10)} · ${row.commit.author} · ${new Date(row.commit.time * 1000).toLocaleString()}\n${row.commit.subject}`}>
              <GraphCell row={row} width={graphWidth} />
              <span className="git-commit-text">
                {row.commit.refs.map((ref) => <span key={ref} className={`git-ref${ref.startsWith("HEAD") ? " is-head" : ref.startsWith("tag:") ? " is-tag" : ""}`}>{ref.replace(/^HEAD -> /, "")}</span>)}
                <span className="git-commit-subject">{row.commit.subject}</span>
              </span>
              <span className="git-commit-author">{row.commit.author}</span>
            </button>
            {opened?.hash === row.commit.hash && <div className="git-commit-files" style={{ paddingLeft: graphWidth * LANE_PX }}>
              <LaneThrough lanes={row.bottom.map(([, to]) => to)} width={graphWidth} />
              <ul className="git-files">
              {opened.base === null && <li className="git-empty">{t("The first commit: open its files from the terminal")}</li>}
              {opened.base !== null && opened.files === null && <li className="git-empty">{t("Reading the repository…")}</li>}
              {opened.files?.map((file) => {
                const { name, folder } = splitPath(file.path);
                const key = `commit:${row.commit.hash}:${file.path}`;
                const request: GitDiffRequest = { scope: "commit", base: opened.base, head: row.commit.hash, path: file.path, oldPath: file.old_path };
                const open = expanded === key;
                return <li key={file.path} className={`git-file-item${open ? " is-open" : ""}`}><div className="git-file">
                  <button type="button" className="git-file-main" aria-expanded={open} onClick={() => toggleDiff(key)}>
                    <span className="git-file-name">{name}</span>{folder && <span className="git-file-folder">{folder}</span>}
                  </button>
                  <span className="git-file-actions">{fullView(request)}</span>
                </div>{open && <InlineDiff paneId={paneId} directory={directory} request={request} />}</li>;
              })}
            </ul>
            </div>}
          </div>)}
          {more && <button type="button" className="git-more" onClick={() => void loadLog(commits.length)}>{t("Load more commits")}</button>}
        </div>}
      </section>
    </>;
  }

  return <aside className="git-panel" aria-label={t("Source Control")}>
    <header className="git-head">
      <span className="git-title">{t("Source Control")}</span>
      <span className="git-head-tools">
        <button type="button" className="git-icon" title={t("Fetch")} aria-label={t("Fetch")} disabled={busy !== null || !status} onClick={() => void run("fetch")}><RefreshCw aria-hidden="true" className={busy === "fetch" ? "is-spinning" : undefined} /></button>
        <button type="button" className="git-icon" title={t("Pull")} aria-label={t("Pull")} disabled={busy !== null || !status?.upstream} onClick={() => void run("pull")}><CloudDownload aria-hidden="true" /></button>
        <button type="button" className="git-icon" title={t("Push")} aria-label={t("Push")} disabled={busy !== null || !status} onClick={() => void run("push")}><CloudUpload aria-hidden="true" /></button>
        <button type="button" className="git-icon" title={t("Close")} aria-label={t("Close")} onClick={onClose}><X aria-hidden="true" /></button>
      </span>
    </header>
    {status && <div className="git-branch-bar">
      <button type="button" className="git-branch" title={t("Switch branch")} aria-haspopup="menu" disabled={busy !== null} onClick={(event) => void openBranches(event.currentTarget)}>
        <GitBranch aria-hidden="true" /><span>{branchWord}</span>
      </button>
      <button type="button" className="git-sync" title={syncLabel} aria-label={syncLabel} disabled={busy !== null}
        onClick={() => void (status.upstream ? run("pull").then((ok) => ok && run("push")) : run("push"))}>
        {status.upstream ? <><ArrowDown aria-hidden="true" />{status.behind}<ArrowUp aria-hidden="true" />{status.ahead}</> : <><CloudUpload aria-hidden="true" />{t("Publish")}</>}
      </button>
    </div>}
    {note && <p className={`git-note${note.failed ? " is-error" : ""}`} role={note.failed ? "alert" : "status"}>
      <span>{note.text}</span><button type="button" className="git-icon" aria-label={t("Dismiss")} onClick={() => setNote(null)}><X aria-hidden="true" /></button>
    </p>}
    {busy && busy !== "commit" && <p className="git-busy" role="status"><GitCommitHorizontal aria-hidden="true" />{busyWord(t, busy)}</p>}
    <div className="git-body">{body}</div>
    {branches && <RowMenu anchor={branches.anchor} title={t("Switch branch")} onClose={() => setBranches(null)} items={branchItems(branches.list)} />}
    {commitMenu && <RowMenu anchor={commitMenu} title={t("Commit")} onClose={() => setCommitMenu(null)} items={[
      { id: "commit-push", label: t("Commit & Push"), icon: CloudUpload, run: () => void commit("push") },
      { id: "amend", label: t("Commit (Amend)"), icon: GitCommitHorizontal, run: () => void commit(undefined, true) },
    ]} />}
    {discard && <ConfirmDialog title={t("Discard changes")} body={t("Discard the changes to {what}? This cannot be undone; new files are deleted.", { what: discard.label })}
      confirmLabel={t("Discard changes")} onClose={() => setDiscard(null)}
      onConfirm={async () => { await run("discard", { ...(discard.tracked.length ? { paths: discard.tracked } : {}), ...(discard.untracked.length ? { untracked: discard.untracked } : {}) }); setDiscard(null); }} />}
  </aside>;
}

function kindWord(t: ReturnType<typeof useT>, kind: GitChange["kind"]): string {
  switch (kind) {
    case "M": return t("File modified");
    case "A": return t("File added");
    case "D": return t("File deleted");
    case "R": return t("File renamed");
    case "C": return t("Copied from another file");
    case "T": return t("File type changed");
    case "U": return t("Conflicted");
    default: return t("Untracked file");
  }
}

function busyWord(t: ReturnType<typeof useT>, op: Op): string {
  switch (op) {
    case "push": return t("Pushing…");
    case "pull": return t("Pulling…");
    case "fetch": return t("Fetching…");
    case "checkout": return t("Switching branch…");
    default: return t("Running git…");
  }
}

function LaneThrough({ lanes, width }: { lanes: number[]; width: number }) {
  return <svg className="git-lanes-through" width={width * LANE_PX} aria-hidden="true">
    {[...new Set(lanes)].map((lane) => <line key={lane} x1={lane * LANE_PX + LANE_PX / 2} x2={lane * LANE_PX + LANE_PX / 2} y1="0" y2="100%" stroke={LANE_COLORS[lane % LANE_COLORS.length]} />)}
  </svg>;
}

function GraphCell({ row, width }: { row: GraphRow; width: number }) {
  const x = (lane: number) => lane * LANE_PX + LANE_PX / 2;
  const mid = ROW_PX / 2;
  const color = (lane: number) => LANE_COLORS[lane % LANE_COLORS.length]!;
  const path = (fromX: number, fromY: number, toX: number, toY: number) => fromX === toX
    ? `M${fromX} ${fromY}V${toY}`
    : `M${fromX} ${fromY}C${fromX} ${(fromY + toY) / 2} ${toX} ${(fromY + toY) / 2} ${toX} ${toY}`;
  return <svg className="git-graph-cell" width={width * LANE_PX} height={ROW_PX} aria-hidden="true">
    {row.top.map(([from, to]) => <path key={`t${from}`} d={path(x(from), 0, x(to), mid)} stroke={color(from)} />)}
    {row.bottom.map(([from, to]) => <path key={`b${from}-${to}`} d={path(x(from), mid, x(to), ROW_PX)} stroke={color(from === row.lane ? to : from)} />)}
    <circle cx={x(row.lane)} cy={mid} r={row.commit.parents.length > 1 ? 4.5 : 3.5} fill={color(row.lane)} />
  </svg>;
}

/** Below 769px the header has no room for the button: the panel is in the ⋯ menu, beside Browse files. */
export function gitPanelMenuItem(t: ReturnType<typeof useT>, run: () => void): RowMenuItem {
  return { id: "git", label: t("Source Control"), icon: GitBranch, run };
}

export function GitPanelButton({ open, onToggle }: { open: boolean; onToggle(): void }) {
  const t = useT();
  return <button type="button" className={`icon-button git-panel-button${open ? " is-open" : ""}`} aria-label={t("Source Control")} title={t("Source Control")} aria-pressed={open} onClick={onToggle}>
    <GitBranch />
  </button>;
}
