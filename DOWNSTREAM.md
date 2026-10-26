# FL-Penly/ovis: a downstream of devswha/ovis

This repository is [Ovis](https://github.com/devswha/ovis) with a few features of its own on top. It follows
upstream's `main` and merges it in regularly, so it has everything upstream has. Keep each patch small and in
files of its own, so a merge rarely conflicts.

## What it adds

**Fork from any reply.** Every finished answer of a Claude Code or Codex pane has a Fork button (⑂, bottom right,
with Copy and the time). Its menu starts the session as it stood at the end of that reply in a new tab of the same workspace or a split right or below, with
the original session's flags and environment; the original keeps running.

**Mode chip, and a model label that switches.** Under the message box of a Claude Code or Codex pane a chip
shows the agent's mode (bypass permissions, plan, accept edits, …, read from its own footer). A press lists the
modes and steps the agent there with its own Shift+Tab (a mode the session turns out not to cycle through leaves
the list); Shift+Tab in the message box steps once. Either way the key goes only while its input box
is on screen. The model and effort label is a button: it sends `/model`, whose picker Ovis shows as a card.

**herdr-web's sidebar.** On top, Start a session and **Waiting on you** (its count; it narrows the list to
agents with an open question or an answer not seen yet). Under Sessions, every workspace is a group head (fold,
branch, a + that asks what the new tab runs, as ⌘T does, and while folded the dot of the agent that most asks for a look) over its tabs
in herdr's order, agents and plain terminals alike. A tab is its top-left pane's row; the other panes of a split tab hang under it,
left to right, then down. An agent's row has herdr-web's state dot, its mark, its title and the count of its background tasks still
running (upstream's `background_tasks`: subagents and background commands, which an agent at rest may still be waiting on); one
button folds or unfolds every workspace. While this sidebar is drawn the tab strip is not (its rows are the tabs; a docked half keeps
its grip): a tab's row moves the tab up or down, and any row splits its pane right or below. A left-press drag moves a workspace
by its head among the others, or a tab by its row within its workspace (a line marks where it lands; dropped on
the pane area, a row still opens in a half). The workspaces that run no agent (agent-board's
Board and Wake, a spare shell) wait under the rest in a **Terminals only** group, folded until opened: one line
each, which opens the pane last viewed there; the group stays open, and the line lit with its tabs beneath it,
while it holds the open pane. A lone PC's header is not drawn. Right-click
(or ⋯) on a pane copies its ID, name, a dispatch command or dispatch instructions (as herdr-web's), renames
or closes it, and a group head offers a terminal tab, an agent tab through upstream's New tab dialog, earlier sessions
and rename. It replaces the
workspace list and the Agents list; the footer's layout button switches back to upstream's (kept per browser),
which keeps the rest of workspace management (worktrees, reorder, pins). Upstream's browser regression scripts
(`scripts/*-regression.ts`) assume that classic layout, so a browser driven by automation (`navigator.webdriver`)
starts on it.

**Sticky prompt.** As in herdr-web, while you read an answer whose prompt has scrolled out of view, that prompt
stays pinned over the top of the chat (two lines); a press scrolls back to it. It reads the minimap's turns.

**Workspace and tab keys.** ⌘↑ / ⌘↓ step to the previous / next row of the tree sidebar, across tabs and
workspaces (a folded workspace is one stop; the classic sidebar: its previous / next workspace), ⌘← / ⌘→ to the
previous / next tab of the open workspace (both wrap around; a terminal with no other tab keeps ⌘← / ⌘→ for its
line), ⌘T asks what a new tab in that workspace runs, and ⌘W closes the open
tab as its × does (a confirm first when an agent in it is at work or it is the workspace's last tab).
Off a Mac they are Ctrl+Alt+arrows, Ctrl+Alt+T and Ctrl+Alt+W. In a text field with text the arrows stay the
field's. A browser tab keeps ⌘T and ⌘W for itself; the installed app gets them.

**Tab menu** (the classic sidebar's strip). The tab's menu leaves out New tab with agent…, since the strip's + asks what a new tab runs, and,
on a tab of one pane, the pane's Close pane, since that pane closes with the tab (Close tab confirms the same
cases). The sidebar's Start an agent here… still opens the full new tab dialog.

**Phone keys.** On a touch screen the terminal keys are mobile-terminal's: three rows (Esc ^C ^L with the input
line and Paste keys; Tab ⇧Tab Enter ⇧Enter and ↑; Combo keys and ← ↓ →), folded to one row on request (kept per
browser). Combo keys opens a panel in their place: Ctrl, Alt and Shift stay on until pressed again, over a
navigation grid and pages of letters and digits, symbols, and editing and function keys; Backspace and the arrows
repeat while held. Every key goes through upstream's key bar path as an exact chord, so herdr encodes it. A tap on
the grid raises no soft keyboard (xterm's textarea is `inputmode="none"`); a double tap raises it or puts it
away (its focus report is not typed, as with upstream's keyboard control). Over the input line, the last ten lines sent (a pick puts one back) and saved phrases (a tap adds one; ☆
saves the line; ✎ shows each phrase's ✕), kept per browser. A desktop keeps upstream's key bar.

**New tab list.** ⌘T, a workspace's + and the tab strip's + list a terminal first, then the PC's installed agents; Enter opens the
highlighted one (the terminal first), ↑↓ move, Esc closes. An agent starts with its own defaults (no model, level
or first message) and Settings' launch mode; the workspace's menu keeps upstream's full dialog. On this PC a split
(a pane's Split right / Split down, or a sidebar row's) asks the same list and runs the pick in the new pane
(`POST /api/pane/split-with`); another PC's bundle splits to a shell as before.

**Long run.** On this PC the new tab list has a second Claude Code row, *long run 500k*: the same start with
`CLAUDE_CODE_AUTO_COMPACT_WINDOW=500000` in the new tab's environment, so the session compacts at 500k tokens.
A request may set that variable alone, as a count (`shared/long-run.ts`). The sidebar marks every Claude pane
whose process runs with a window of its own (*500k*), read from the process's environment (Linux), so one
started by hand counts too.

**Source Control.** A Git button beside Browse files (this PC's panes) opens a panel after VS Code's for the
repository around the pane's folder: the branch (a press switches to another or creates one) and sync with its
ahead and behind counts, fetch, pull and push (a branch with no upstream is published to origin); the commit
message with Commit (⌘↵; with nothing staged every change goes in, as VS Code's smart commit), Commit & Push and
Amend; Merge Changes, Staged Changes and the unstaged ones, each file with stage, unstage or discard (a confirm
first); and the commit graph, drawn in SVG lanes, where a commit lists its files. A press on a file, changed or
in a commit, opens its change under the row (one column, wrapped, a line of context, upstream's RepoDiff in a
box as tall as the change, 60% of the screen at most) and a second press closes it, one file at a time; the
row's other button opens it in upstream's diff viewer. Git runs as argv with no prompt, editor or ssh question to wait on; git's own words show
when it refuses. Docked last in the row from 980px, over the pane below that; on a phone (below 769px) it is
in the header's ⋯ menu, under Browse files.

**Images in a read-only project.** A pasted or attached image goes in `<pane folder>/.ovis/`; when `.ovis` cannot
be made there (a read-only checkout), it goes in the temp dir's `ovis/.ovis/`, as for a pane with no folder,
instead of failing (`server/paste.ts`, one hunk). A `.ovis` already there and a folder named in `OVIS_PASTE_DIR`
still fail as before.

**A Codex chat beside its fork.** A fork holds every answer of the conversation it was cut from, so a Codex
pane's chat could not tell its own conversation from the fork's (and showed the terminal), most of all once
the original was backtracked to the fork point. A rollout another pane was started on with
`codex resume <thread>` is now left out when the screen matches several, so each pane shows its own.

**Read finishes survive a restart.** A browser keys a finish it has read by the server's finish epoch and the
pane's finish count (`shared/seen.ts`). Upstream draws a new epoch each time this server starts, so after an
update or a restart every agent still finished showed as not seen again. The epoch and the counts now live in
`finishes.json` in the state directory and are taken up again while herdr runs on (its socket's identity is
the same); a new herdr still starts a new epoch. A pane that finished while the server was down counts a new
finish (`server/finishes.ts`).

**A local extension slot.** One person's own extension, kept out of git, in the folder `OVIS_LOCAL_DIR` names
(set in the plugin's `env` file, so the updater's builds and the server both see it). Unset, nothing changes:
the build takes a stub that extends nothing, and `/api/local/*` answers 404. Its `client/index.tsx` is built in
through the `ovis-local/client` alias (`vite.config.ts`), imports Ovis's modules as `ovis-src/…`, and may replace
the phone keys, set up each pane's terminal and change the double tap's window (`src/lib/localExtensions.ts`).
Its `server/index.ts` answers `/api/local/*` after the token and same-origin checks; a watching device gets none
of it. The client part is built in: a change to it shows after the next build (an update, or `bun run build`).

| File | What it holds |
| --- | --- |
| `integrations/quick-fork/` | quick-fork, vendored from herdr-web: cuts the transcript or rollout and starts the copy. Still a herdr plugin of its own (`herdr plugin link "$PWD/integrations/quick-fork"`). |
| `server/fork-routes.ts` (+ test) | `POST /api/pane/fork {pane_id, end_ts?, mode?}`: finds the fork point by the reply's `end_ts` in the pane's own transcript and calls quick-fork. |
| `src/components/ForkButton.tsx` | The button. Shown for this PC's panes only: another PC runs upstream's published bundle. |
| `src/lib/agentMode.ts` (+ test, `fixtures-agent-mode/`) | Reads the mode from the visible screen; ported from herdr-web with its screen fixtures. |
| `src/components/ModeChip.tsx` (+ css) | The chip. It reads the screen and sends the key through upstream's `pane/read` and `pane/keys` routes, so remote PCs get it too. |
| `src/lib/i18n/downstream.{zh,ja,ko}.ts` | The strings of both. |
| `src/components/TreeSidebar.tsx` (+ css, test) | The herdr-web sidebar, its Waiting on you switch and the layout button. |
| `src/components/StickyPrompt.tsx` (+ css, test) | The sticky prompt over the chat. |
| `src/components/PhoneKeys.tsx` (+ css), `src/components/LineExtras.tsx` (+ css), `src/lib/phoneKeys.ts` (+ test), `src/lib/useDoubleTapKeyboard.ts` | The phone keys, the line's recent lines and phrases, and the double tap for the keyboard; `Key` and `Chevron` are exported from upstream's `KeyBar.tsx` for them. |
| `src/lib/upstreamTests.ts` | `drivenByTests`: under upstream's browser scripts (`navigator.webdriver`) the classic sidebar, the strip's + and upstream's key bar stay upstream's. |
| `src/components/QuickTabPicker.tsx` (+ css) | The new tab list; `openTerminalTab`'s `agent` (`src/lib/actions.ts`, `App.tsx`) runs the pick. |
| `server/split-launch.ts`, `src/lib/splitLaunch.ts` | `POST /api/pane/split-with {pane_id, direction, agent?, env?}` and `openSplit` (`src/lib/actions.ts`, `App.tsx`); `PaneCanvas.tsx` and the sidebar open the list for a split. |
| `shared/long-run.ts`, `server/long-run.ts` (+ test), `src/lib/longRun.ts` | The long run's window and the one variable a request may set; `GET /api/pane/long-run` and the sidebar's mark. |
| `src/lib/navShortcuts.ts` (+ test) | The workspace and tab keys; ⌘W reaches the open tab's strip through `useCloseTabKey`. |
| `shared/git-panel.ts`, `server/git-panel.ts`, `server/git-panel-routes.ts` (+ test) | `/api/pane/git/{status,log,branches}` (GET) and `/api/pane/git/{stage,unstage,discard,commit,push,pull,fetch,checkout}` (POST). |
| `src/components/GitPanel.tsx` (+ css), `src/lib/gitPanel.ts` (+ test) | The panel, its requests and the graph's lanes. |
| `server/telemetry-default.test.ts` | Usage counts off on a fresh install. |
| `server/codex-forks.test.ts` | The Codex chat beside a fork (`matchBesideForks`, at the end of `server/codex.ts`). |
| `server/finishes.ts` (+ test) | The finish epoch and counts kept in `finishes.json`; `server/core/status.ts` gives it the file. |
| `server/update-state-symlink.test.ts` | Updates under a home reached through a symlink (`launcherSpelling` in `server/update-state.ts`). |
| `src/lib/localExtensions.ts`, `src/lib/localExtensionsStub.ts`, `server/localExtensions.ts` (+ test) | The local extension slot; `PaneTerminal.tsx` takes its phone keys and terminal setup, `server/index.ts` its routes. |

Lines in upstream's own files are marked `downstream`, so `git grep -n downstream` lists every hook:
`server/pane-routes.ts` (6 lines: fork, git and long run), `server/workspace-routes.ts` and `shared/workspace-lifecycle.ts` (a new tab's `env`, the split-with route), `server/herdr/client.ts` (`paneSplitWithEnv`), `src/lib/api.ts` (`sendJson` exported), `src/components/PaneCanvas.tsx` (a split asks), `server/index.ts` and `server/telemetry.ts` (usage counts off by default, 3 lines; the local slot's routes, 3 lines), `server/core/status.ts` (the finish state's file, 1 line), `server/update-state.ts` (the supervisor's state dir under a symlinked home), `vite.config.ts` and `tsconfig.json` (the `ovis-local/client` alias), `src/lib/useDoubleTapKeyboard.ts` (its window as a parameter), `scripts/conventions.test.ts` (`/api/local` in DEMO_404), `server/codex.ts` (2 lines, and `matchBesideForks` at its end), `server/paste.ts` (a read-only project's images), `src/components/ChatView.tsx` (a few one-line hunks: the fork button, the sticky prompt),
`src/components/Composer.tsx` (the chip, and the model label as a button),
`src/App.tsx` (the workspace and tab keys, the Git button and panel), `src/components/TabStrip.tsx` (⌘W, the tab menu), `src/components/MachineSidebar.tsx` (the sidebar in place of the lists, a lone PC's header, and the layout button),
`src/lib/i18n.{zh,ja,ko}.ts` and `src/lib/i18n.test.ts` (the `downstream` part), and `scripts/conventions.test.ts`
(the demo has no fork route). Not marked: the fork note at the top of `README.md` and `README.zh-CN.md`, and this fork's copyright line in
`LICENSE` and the README's license section. `git diff upstream/main...main` shows the whole patch.

## Syncing with upstream

```sh
scripts/downstream-sync.sh            # merge upstream main, check, push main and the version tag
scripts/downstream-sync.sh --no-push  # merge and check only
scripts/downstream-sync.sh --no-upstream  # check and release this main as it is, between syncs
```

`main` merges upstream's `main` in, never rebases onto it: a rebase flattens the earlier merges and replays
every conflict they already solved. `git log --no-merges upstream/main..main` lists this fork's commits and
`git diff upstream/main...main` the whole patch. The script merges `upstream/main` (keeping the old head as
`backup/pre-sync`), runs typecheck, build and the downstream tests, and pushes `main`. On a conflict it aborts
the merge and lists the files (exit 2); merge on a branch (`chore/sync-upstream-<version>`), resolve them
there, open a PR and land it on `main` as it is, never squashed: a squash drops upstream as a parent, and the
next sync would meet every conflict again. Then release with `--no-upstream`. `git rerere` replays a
resolution next time. If a check fails it undoes the merge (exit 3).

## Releases and updates

**Updates under a symlinked home.** Upstream's supervisor finds its state dir from its own release's path,
which Bun gives as the real path, while the plugin's launcher names it as `$HOME` spells it and resumes only a
release record under that name. Where `$HOME` is a symlink (`/home/me` → `/data00/home/me`) every install was
then dropped at the handover and the source checkout served again. The supervisor now keeps the launcher's
name for the same dir.

The in-app updater fetches `v*` tags from the install's `origin` and offers the newest one when it descends
from the running commit. Hence:

- **Upstream's tags are not kept here.** Each sync tags the release with the version in `package.json` and
  moves that tag forward when it already exists. Never push upstream's tags to this fork: the updater would
  offer upstream's build, without these features.
- **The tag sits on a bridge commit, not on `main`.** `main` does not descend from what installs run (the
  previous bridge), so the script tags a commit with `main`'s tree whose parents are `main` and the previous
  release: this version's tag, or the newest `v*` tag when a sync raises the version. The updater takes it as
  an update and builds exactly `main`; `main` itself never holds these commits.

Install (replaces upstream's plugin, which has the same id `devswha.ovis`):

```sh
cp "$(herdr plugin config-dir devswha.ovis)/env" /tmp/ovis.env   # keep HOST, PORT, OVIS_TOKEN …
herdr plugin action invoke devswha.ovis.stop
herdr plugin uninstall devswha.ovis
herdr plugin install FL-Penly/ovis --yes
cp /tmp/ovis.env "$(herdr plugin config-dir devswha.ovis)/env"
herdr plugin action invoke devswha.ovis.start
```

## Not covered

- Remote PCs added over SSH run upstream's bundle (`server/remote-bundle.ts`), so they have no Fork button.
- Install counts go to upstream's telemetry when turned on. A fresh install of this fork starts with them off
  (`enabledByDefault: false` in `server/index.ts`); an install that already had them on keeps its choice.
