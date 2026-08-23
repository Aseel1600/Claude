#!/usr/bin/env bash
#
# OmniRoute fork — pull new upstream code into the deployable `prod` branch.
#
#   infra/sync-upstream.sh                 # track the newest upstream release/v* branch
#   infra/sync-upstream.sh --ref main      # track main instead
#   infra/sync-upstream.sh --ref v3.8.50   # pin to a tag once it is cut
#   infra/sync-upstream.sh --dry-run       # show what would be merged, change nothing
#   infra/sync-upstream.sh --push          # also push prod (which triggers a deploy)
#
# How this fork is laid out
# ─────────────────────────
#   upstream            diegosouzapw/OmniRoute   (read-only, never pushed to)
#   origin              your fork
#   prod                upstream code + infra/ + .github/workflows/prod-*.yml
#
# Everything this fork adds lives in NEW files (infra/, prod-*.yml), so merging
# upstream is normally conflict-free. If you ever edit an upstream file, that
# file becomes your merge burden — keep such edits few and deliberate.
#
# Why "newest release/v* branch" is the default
# ─────────────────────────────────────────────
#   Upstream develops each cycle on release/vX.Y.Z, squash-merges it to main
#   when the cycle ships, and only then cuts the vX.Y.Z tag. So an unreleased
#   version exists ONLY as a release/* branch. Auto-detecting the highest one
#   means you keep following the active cycle when it rolls from
#   release/v3.8.50 to release/v3.8.51 without editing anything here.
#
#   Trade-off, stated plainly: that branch is the development tip. It is CI-gated
#   but not frozen, and it does go red (the current tip is itself a fix for a
#   broken build). For a calmer line use `--ref main`, and for the calmest use
#   `--ref vX.Y.Z` once the tag exists.
#
set -Eeuo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

PROD_BRANCH="${PROD_BRANCH:-prod}"
REF=""
DRY_RUN=0
DO_PUSH=0

while [[ $# -gt 0 ]]; do
    case "$1" in
        --ref)     REF="${2:?--ref needs a value}"; shift 2 ;;
        --dry-run) DRY_RUN=1; shift ;;
        --push)    DO_PUSH=1; shift ;;
        -h|--help) sed -n '2,30p' "$0"; exit 0 ;;
        *)         echo "unknown argument: $1" >&2; exit 1 ;;
    esac
done

git remote get-url upstream >/dev/null 2>&1 \
    || { echo "no 'upstream' remote. Add it with:" >&2
         echo "  git remote add upstream https://github.com/diegosouzapw/OmniRoute.git" >&2
         exit 1; }

echo "==> Fetching upstream"
git fetch upstream --prune --tags

if [[ -z "$REF" ]]; then
    # sort -V compares numeric segments, so v3.8.9 sorts BELOW v3.8.50 —
    # a plain lexicographic sort would get this backwards.
    REF="$(git branch -r --list 'upstream/release/v*' \
           | sed 's#^[[:space:]]*upstream/##' \
           | sort -V \
           | tail -n1)"
    [[ -n "$REF" ]] || { echo "no upstream release/v* branch found" >&2; exit 1; }
    echo "==> Auto-selected newest upstream release branch: $REF"
fi

# Resolve whatever the user gave us to something git can merge.
if git rev-parse --verify --quiet "upstream/$REF" >/dev/null; then
    MERGE_REF="upstream/$REF"
elif git rev-parse --verify --quiet "refs/tags/$REF" >/dev/null; then
    MERGE_REF="refs/tags/$REF"
else
    echo "cannot resolve '$REF' as an upstream branch or a tag" >&2
    exit 1
fi

CURRENT="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$CURRENT" != "$PROD_BRANCH" ]]; then
    if [[ -n "$(git status --porcelain)" ]]; then
        echo "working tree is dirty — commit or stash before switching to $PROD_BRANCH" >&2
        exit 1
    fi
    git checkout "$PROD_BRANCH"
fi

BEHIND="$(git rev-list --count "HEAD..$MERGE_REF")"
echo "==> $PROD_BRANCH is $BEHIND commit(s) behind $MERGE_REF"

if [[ "$BEHIND" == "0" ]]; then
    echo "Already up to date. Nothing to do."
    exit 0
fi

echo
echo "--- upstream commits that would land (newest 25) ---"
git log --oneline --no-decorate -25 "HEAD..$MERGE_REF"
echo "----------------------------------------------------"
echo

# The app version is the single most useful thing to eyeball before deploying.
CUR_VER="$(git show HEAD:package.json | sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' | head -1)"
NEW_VER="$(git show "$MERGE_REF:package.json" | sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' | head -1)"
echo "version: $CUR_VER -> $NEW_VER"
echo

if [[ "$DRY_RUN" == "1" ]]; then
    echo "(--dry-run: stopping here, nothing was merged)"
    exit 0
fi

echo "==> Merging $MERGE_REF into $PROD_BRANCH"
if ! git merge --no-edit "$MERGE_REF"; then
    cat >&2 <<'CONFLICT'

Merge conflict. This fork only ADDS files, so a conflict means an upstream
file you also edited moved. Resolve it, then:

    git add <files>
    git commit
    git push origin prod      # triggers the deploy workflow

To abandon instead:  git merge --abort
CONFLICT
    exit 1
fi

echo "==> Merged. Now on $(git rev-parse --short HEAD) (OmniRoute $NEW_VER)"

if [[ "$DO_PUSH" == "1" ]]; then
    echo "==> Pushing $PROD_BRANCH — this triggers build + deploy"
    git push origin "$PROD_BRANCH"
else
    echo
    echo "Review, then deploy with:"
    echo "    git push origin $PROD_BRANCH"
fi
