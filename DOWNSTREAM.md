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
| `server/codex-forks.test.ts` | The Codex chat beside a fork (`matchBesideForks`, at the end of `server/codex.ts`). |

Lines in upstream's own files are marked `downstream`, so `git grep -n downstream` lists every hook:
`server/pane-routes.ts` (2 lines), `server/codex.ts` (2 lines, and `matchBesideForks` at its end), `src/components/ChatView.tsx` (a few one-line hunks),
`src/components/Composer.tsx` (the chip, and the model label as a button),
`src/lib/i18n.{zh,ja,ko}.ts` and `src/lib/i18n.test.ts` (the `downstream` part), and `scripts/conventions.test.ts`
(the demo has no fork route). `git diff upstream/main...main` shows the whole patch.

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
- Install counts, if left on, go to upstream's telemetry (`OVIS_TELEMETRY=0` turns them off).
