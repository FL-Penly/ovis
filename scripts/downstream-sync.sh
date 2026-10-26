#!/usr/bin/env bash
# Downstream (FL-Penly/ovis): merge upstream devswha/ovis main into this fork's main, check the
# downstream patches still build and pass, then push main and the release tag. See DOWNSTREAM.md.
#
#   scripts/downstream-sync.sh            merge, check, push
#   scripts/downstream-sync.sh --no-push  merge and check only
#   scripts/downstream-sync.sh --no-upstream  check and push this main as it is: a release between syncs
#
# Exit codes: 0 synced or already up to date, 2 merge conflict (aborted), 3 checks failed (merge undone).
set -euo pipefail

push=1
sync=1
for arg in "$@"; do
  case "$arg" in
    --no-push) push=0 ;;
    --no-upstream) sync=0 ;;
    *) printf '[downstream-sync] unknown option %s\n' "$arg"; exit 1 ;;
  esac
done

cd "$(git rev-parse --show-toplevel)"
say() { printf '[downstream-sync] %s\n' "$*"; }

[ "$(git branch --show-current)" = main ] || { say "check out main first"; exit 1; }
git diff --quiet && git diff --cached --quiet || { say "the working tree has changes; commit or stash them first"; exit 1; }
git remote get-url upstream >/dev/null 2>&1 || git remote add upstream https://github.com/devswha/ovis.git

before=$(git rev-parse HEAD)
if [ "$sync" = 0 ]; then
  # main must already be origin's main or ahead of it: a release never drops a pushed commit
  git fetch --no-tags origin main
  git merge-base --is-ancestor origin/main HEAD || { say "main is behind origin/main; pull first"; exit 1; }
  say "not syncing with upstream (--no-upstream)"
else
# Upstream's tags are never fetched: this fork's v* tags are its own releases (DOWNSTREAM.md).
git fetch --no-tags upstream main
# upstream's main is merged in, never rebased onto: a rebase replays conflicts earlier merges solved.
if git merge-base --is-ancestor upstream/main HEAD; then
  say "already on upstream $(git rev-parse --short upstream/main)"
else
  git branch -f backup/pre-sync "$before"
  if ! git -c rerere.enabled=true -c rerere.autoUpdate=true merge --no-ff --no-edit -m "chore(upstream): merge upstream/main" upstream/main; then
    say "conflicts:"
    git diff --name-only --diff-filter=U | sed 's/^/  /'
    git merge --abort
    say "resolve them on a branch: git merge upstream/main (git rerere replays a resolution next time)"
    exit 2
  fi
fi
fi

if ! { bun install --frozen-lockfile &&
  bun run typecheck &&
  bun run build &&
  bun test server/fork-routes.test.ts server/telemetry-default.test.ts server/codex-forks.test.ts server/codex-processes.test.ts server/git-panel.test.ts src/lib/gitPanel.test.ts integrations/quick-fork src/lib/agentMode.test.ts src/components/TreeSidebar.test.ts src/components/StickyPrompt.test.ts src/lib/navShortcuts.test.ts src/lib/i18n.test.ts server/update-state-symlink.test.ts scripts/conventions.test.ts; }; then
  say "checks failed; undoing the merge"
  git reset --hard "$before"
  exit 3
fi

if [ "$push" = 0 ]; then
  say "merged and checked; not pushed (--no-push)"
  exit 0
fi

version="v$(bun -e 'console.log((await Bun.file("package.json").json()).version)')"
# only this fork's release tags: the newest of them is what installs run
git fetch --no-tags origin '+refs/tags/v*:refs/tags/v*' 2>/dev/null || true
git push --force-with-lease origin main
# The release tag sits on a bridge commit: main's own tree, with main and the previous release as its
# parents. The in-app updater takes only a descendant of what it runs, and main is not one: each
# release's bridge is a commit main never holds. The previous release is this version's tag, else the
# newest release tag (a sync that raises the version).
previous=$(git rev-parse -q --verify "refs/tags/$version^{commit}" || true)
same=$previous
if [ -z "$previous" ]; then
  newest=$(git ls-remote --tags --refs origin 'v*' | sed 's|.*refs/tags/||' | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | tail -1 || true)
  [ -n "$newest" ] && previous=$(git rev-parse -q --verify "refs/tags/$newest^{commit}" || true)
fi
if [ -n "$same" ] && [ "$(git rev-parse "$same^{tree}")" = "$(git rev-parse "HEAD^{tree}")" ]; then
  say "pushed main; $version already releases this tree"
  exit 0
fi
release=$(git rev-parse HEAD)
if [ -n "$previous" ] && ! git merge-base --is-ancestor "$previous" HEAD; then
  release=$(git commit-tree "HEAD^{tree}" -p HEAD -p "$previous" -m "chore(downstream): release $version at $(git rev-parse --short HEAD)")
fi
git tag -f "$version" "$release"
git push -f origin "refs/tags/$version"
say "pushed main and $version ($(git rev-parse --short "$release"))"
