#!/usr/bin/env bash
# Downstream (FL-Penly/ovis): rebase this fork's commits onto upstream devswha/ovis main, check the
# downstream patches still build and pass, then push main and the release tag. See DOWNSTREAM.md.
#
#   scripts/downstream-sync.sh            rebase, check, push
#   scripts/downstream-sync.sh --no-push  rebase and check only
#
# Exit codes: 0 synced or already up to date, 2 rebase conflict (aborted), 3 checks failed (rebase undone).
set -euo pipefail

push=1
[ "${1:-}" = "--no-push" ] && push=0

cd "$(git rev-parse --show-toplevel)"
say() { printf '[downstream-sync] %s\n' "$*"; }

[ "$(git branch --show-current)" = main ] || { say "check out main first"; exit 1; }
git diff --quiet && git diff --cached --quiet || { say "the working tree has changes; commit or stash them first"; exit 1; }
git remote get-url upstream >/dev/null 2>&1 || git remote add upstream https://github.com/devswha/ovis.git

# Upstream's tags are never fetched: this fork's v* tags are its own releases (DOWNSTREAM.md).
git fetch --no-tags upstream main
before=$(git rev-parse HEAD)
# main is upstream's main with this fork's few commits on top: a rebase, never a merge.
if git merge-base --is-ancestor upstream/main HEAD; then
  say "already on upstream $(git rev-parse --short upstream/main)"
else
  git branch -f backup/pre-sync "$before"
  if ! git -c rerere.enabled=true -c rerere.autoUpdate=true rebase upstream/main; then
    say "conflicts:"
    git diff --name-only --diff-filter=U | sed 's/^/  /'
    git rebase --abort
    say "resolve them with: git rebase upstream/main (git rerere replays a resolution next time)"
    exit 2
  fi
fi

if ! { bun install --frozen-lockfile &&
  bun run typecheck &&
  bun run build &&
  bun test server/fork-routes.test.ts server/telemetry-default.test.ts server/codex-forks.test.ts server/codex-processes.test.ts server/git-panel.test.ts src/lib/gitPanel.test.ts integrations/quick-fork src/lib/agentMode.test.ts src/components/TreeSidebar.test.ts src/components/StickyPrompt.test.ts src/lib/navShortcuts.test.ts src/lib/i18n.test.ts scripts/conventions.test.ts; }; then
  say "checks failed; undoing the rebase"
  git reset --hard "$before"
  exit 3
fi

if [ "$push" = 0 ]; then
  say "rebased and checked; not pushed (--no-push)"
  exit 0
fi

version="v$(bun -e 'console.log((await Bun.file("package.json").json()).version)')"
git fetch --no-tags origin "+refs/tags/$version:refs/tags/$version" 2>/dev/null || true
git push --force-with-lease origin main
# The release tag sits on a bridge commit: main's own tree, with main and the previous release as its
# parents. The in-app updater takes only a descendant of what it runs, and a rebased main is not one.
previous=$(git rev-parse -q --verify "refs/tags/$version^{commit}" || true)
if [ -n "$previous" ] && [ "$(git rev-parse "$previous^{tree}")" = "$(git rev-parse "HEAD^{tree}")" ]; then
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
