#!/bin/bash
# Bump version, regenerate CHANGELOG.md via git-cliff, tag, and publish a GitHub
# Release. Usage: release.sh <patch|minor|major> or release.sh --version X.Y.Z
#
# Errors from gh release create/edit are NEVER silenced (2>/dev/null on both
# attempts hid every failure in an earlier version of this pattern elsewhere —
# 20 releases went out with empty stub bodies over several weeks before anyone
# noticed). Any release-publish failure here prints loudly; the tag/push already
# succeeded by that point regardless.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! command -v git-cliff &>/dev/null; then
  echo "git-cliff not found. Install with: brew install git-cliff" >&2
  exit 1
fi

CURRENT_VERSION="$(node -p "require('./package.json').version")"

if [[ "${1:-}" == "--version" ]]; then
  NEW_VERSION="$2"
else
  IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT_VERSION"
  case "${1:-patch}" in
    major) NEW_VERSION="$((MAJOR + 1)).0.0" ;;
    minor) NEW_VERSION="${MAJOR}.$((MINOR + 1)).0" ;;
    patch|*) NEW_VERSION="${MAJOR}.${MINOR}.$((PATCH + 1))" ;;
  esac
fi
TAG="v${NEW_VERSION}"
echo "Releasing $TAG (was $CURRENT_VERSION)..."
node -e "const fs=require('fs'); const p='package.json'; const j=JSON.parse(fs.readFileSync(p)); j.version='${NEW_VERSION}'; fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n')"

git-cliff --tag "$TAG" --output CHANGELOG.md
git add CHANGELOG.md
git add "package.json"
git commit -m "chore(release): ${TAG}"
git tag "$TAG" -m "$TAG"
git push origin HEAD
git push origin "refs/tags/$TAG"

PREV_TAG="$(git tag --sort=-v:refname | grep -v "^${TAG}$" | head -1)"
if [[ -n "$PREV_TAG" ]]; then
  NOTES="$(git-cliff "${PREV_TAG}..${TAG}" --strip header 2>/dev/null)"
else
  NOTES="$(git-cliff --tag "$TAG" --strip header 2>/dev/null)"
fi
# GitHub release-notes body caps at 125000 chars — a missing/wrong prev-tag range
# (e.g. an empty PREV_TAG dumping full history) silently 422s past this limit.
NOTES_LEN=$(echo -n "$NOTES" | wc -c | tr -d ' ')
if [[ $NOTES_LEN -gt 120000 ]]; then
  echo "generated notes are ${NOTES_LEN} chars, over the safe limit — truncating" >&2
  NOTES="$(echo "$NOTES" | head -c 119000)"$'\n\n'"...(truncated, see CHANGELOG.md for the rest)"
fi

create_err="$(gh release create "$TAG" --repo Vit129/agy-plugin-cc --title "$TAG" --notes "$NOTES" 2>&1 >/dev/null)"
if [[ $? -ne 0 ]]; then
  edit_err="$(gh release edit "$TAG" --repo Vit129/agy-plugin-cc --title "$TAG" --notes "$NOTES" 2>&1 >/dev/null)"
  if [[ $? -ne 0 ]]; then
    echo "GitHub release create AND edit both failed for $TAG:" >&2
    echo "  create: $create_err" >&2
    echo "  edit:   $edit_err" >&2
    exit 1
  fi
fi

echo "Released $TAG"
