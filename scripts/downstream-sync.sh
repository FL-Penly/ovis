#!/usr/bin/env bash
# Downstream (FL-Penly/ovis): merge upstream devswha/ovis main into this fork's main, check the
# downstream patches still build and pass, then push main and the release tag. See DOWNSTREAM.md.
#
#   scripts/downstream-sync.sh            merge, check, push
#   scripts/downstream-sync.sh --no-push  merge and check only
#
# Exit codes: 0 synced or already up to date, 2 merge conflict (aborted), 3 checks failed (merge undone).
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
if git merge-base --is-ancestor upstream/main HEAD; then
  say "already contains upstream $(git rev-parse --short upstream/main)"
  exit 0
fi

before=$(git rev-parse HEAD)
# A merge, never a rebase: the updater offers a release only when it descends from the running one.
if ! git -c rerere.enabled=true -c rerere.autoUpdate=true merge --no-ff --no-edit upstream/main \
  -m "chore(downstream): merge upstream $(git rev-parse --short upstream/main)"; then
  if [ -z "$(git diff --name-only --diff-filter=U)" ]; then
    git commit --no-edit
  else
    say "conflicts:"
    git diff --name-only --diff-filter=U | sed 's/^/  /'
    git merge --abort
    exit 2
  fi
fi

if ! { bun install --frozen-lockfile &&
  bun run typecheck &&
  bun run build &&
  bun test server/fork-routes.test.ts server/codex-forks.test.ts server/codex-processes.test.ts integrations/quick-fork src/lib/agentMode.test.ts src/lib/i18n.test.ts scripts/conventions.test.ts; }; then
  say "checks failed; undoing the merge"
  git reset --hard "$before"
  exit 3
fi

if [ "$push" = 0 ]; then
  say "merged and checked; not pushed (--no-push)"
  exit 0
fi

version="v$(bun -e 'console.log((await Bun.file("package.json").json()).version)')"
git push origin main
# The version tag moves forward with each sync: installs fetch tags with force and only ever
# take a descendant of what they run, so a moved tag is offered as an update.
git tag -f "$version"
git push -f origin "refs/tags/$version"
say "pushed main and $version"
