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
branch, a + that asks what the new tab runs, as ⌘T does, and while folded the dot of the agent that most asks for a look) over its agents, each
with herdr-web's state dot, its mark, its title and the count of its background tasks still running (upstream's
`background_tasks`: subagents and background commands, which an agent at rest may still be waiting on); plain terminals join their workspaces when the list's
terminal switch is on, and one button folds or unfolds them all. The workspaces that run no agent (agent-board's
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

**Workspace and tab keys.** ⌘↑ / ⌘↓ step to the previous / next workspace the sidebar shows, ⌘← / ⌘→ to the
previous / next tab of the open workspace (both wrap around; a terminal with no other tab keeps ⌘← / ⌘→ for its
line), ⌘T asks what a new tab in that workspace runs, and ⌘W closes the open
tab as its × does (a confirm first when an agent in it is at work or it is the workspace's last tab).
Off a Mac they are Ctrl+Alt+arrows, Ctrl+Alt+T and Ctrl+Alt+W. In a text field with text the arrows stay the
field's. A browser tab keeps ⌘T and ⌘W for itself; the installed app gets them.

**New tab list.** ⌘T and a workspace's + list a terminal first, then the PC's installed agents; Enter opens the
highlighted one (the terminal), 1–9 pick a row, Esc closes. An agent starts with its own defaults (no model, level
or first message) and Settings' launch mode; the workspace's menu keeps upstream's full dialog.

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

**A Codex chat beside its fork.** A fork holds every answer of the conversation it was cut from, so a Codex
pane's chat could not tell its own conversation from the fork's (and showed the terminal), most of all once
the original was backtracked to the fork point. A rollout another pane was started on with
`codex resume <thread>` is now left out when the screen matches several, so each pane shows its own.

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
| `src/components/QuickTabPicker.tsx` (+ css) | The new tab list; `openTerminalTab`'s `agent` (`src/lib/actions.ts`, `App.tsx`) runs the pick. |
| `src/lib/navShortcuts.ts` (+ test) | The workspace and tab keys; ⌘W reaches the open tab's strip through `useCloseTabKey`. |
| `shared/git-panel.ts`, `server/git-panel.ts`, `server/git-panel-routes.ts` (+ test) | `/api/pane/git/{status,log,branches}` (GET) and `/api/pane/git/{stage,unstage,discard,commit,push,pull,fetch,checkout}` (POST). |
| `src/components/GitPanel.tsx` (+ css), `src/lib/gitPanel.ts` (+ test) | The panel, its requests and the graph's lanes. |
| `server/telemetry-default.test.ts` | Usage counts off on a fresh install. |
| `server/codex-forks.test.ts` | The Codex chat beside a fork (`matchBesideForks`, at the end of `server/codex.ts`). |

Lines in upstream's own files are marked `downstream`, so `git grep -n downstream` lists every hook:
`server/pane-routes.ts` (4 lines: fork and git), `server/index.ts` and `server/telemetry.ts` (usage counts off by default, 3 lines), `server/codex.ts` (2 lines, and `matchBesideForks` at its end), `src/components/ChatView.tsx` (a few one-line hunks: the fork button, the sticky prompt),
`src/components/Composer.tsx` (the chip, and the model label as a button),
`src/App.tsx` (the workspace and tab keys, the Git button and panel), `src/components/TabStrip.tsx` (⌘W), `src/components/MachineSidebar.tsx` (the sidebar in place of the lists, a lone PC's header, and the layout button),
`src/lib/i18n.{zh,ja,ko}.ts` and `src/lib/i18n.test.ts` (the `downstream` part), and `scripts/conventions.test.ts`
(the demo has no fork route). Not marked: the fork note at the top of `README.md` and `README.zh-CN.md`, and this fork's copyright line in
`LICENSE` and the README's license section. `git diff upstream/main...main` shows the whole patch.

## Syncing with upstream

```sh
scripts/downstream-sync.sh            # rebase onto upstream main, check, push main and the version tag
scripts/downstream-sync.sh --no-push  # rebase and check only
```

`main` is upstream's `main` with this fork's commits on top, one per feature, so
`git log upstream/main..main` lists the whole patch. The script rebases them onto `upstream/main` (keeping the
old head as `backup/pre-sync`), runs typecheck, build and the downstream tests, and force-pushes `main`. On a
conflict it aborts the rebase and lists the files (exit 2); resolve them by hand with
`git rebase upstream/main`, and `git rerere` replays the same resolution next time. If a check fails it undoes
the rebase (exit 3). A fix to a feature goes into that feature's commit (`git commit --fixup` and
`git rebase -i --autosquash upstream/main`); a new feature is a commit of its own.

## Releases and updates

The in-app updater fetches `v*` tags from the install's `origin` and offers the newest one when it descends
from the running commit. Hence:

- **Upstream's tags are not kept here.** Each sync tags the release with the version in `package.json` and
  moves that tag forward when it already exists. Never push upstream's tags to this fork: the updater would
  offer upstream's build, without these features.
- **The tag sits on a bridge commit, not on `main`.** A rebased `main` does not descend from what installs
  run, so the script tags a commit with `main`'s tree whose parents are `main` and the previous release. The
  updater takes it as an update and builds exactly `main`; `main` itself never holds these commits.

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
