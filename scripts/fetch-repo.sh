#!/usr/bin/env bash
# Shallow-clones a GitHub repository for reading (its code is never run).
#   fetch-repo.sh <github url | owner/repo | local path> <dest dir>
# Prints the path, the commit and its date. Private repositories work through `gh` when it's signed in.
set -euo pipefail
src="${1:?repository URL, owner/repo or local path}"
dest="${2:?destination directory}"

if [ -d "$src" ]; then
  path="$(cd "$src" && pwd)"
else
  slug="$(printf '%s' "$src" | sed -E 's#^(https?://)?(www\.)?github\.com/##; s#^git@github\.com:##; s#\.git$##; s#/(tree|blob)/.*$##; s#/+$##')"
  case "$slug" in */*) ;; *) echo "Not a GitHub repository: $src" >&2; exit 1 ;; esac
  path="$dest/$(printf '%s' "$slug" | tr '/' '_')"
  if [ ! -d "$path/.git" ]; then
    mkdir -p "$dest"
    if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
      gh repo clone "$slug" "$path" -- --depth 1 --quiet
    else
      git clone --depth 1 --quiet "https://github.com/$slug.git" "$path"
    fi
  fi
fi
commit="$(git -C "$path" rev-parse --short HEAD 2>/dev/null || echo "")"
date="$(git -C "$path" log -1 --format=%cs 2>/dev/null || echo "")"
remote="$(git -C "$path" remote get-url origin 2>/dev/null | sed -E 's#^git@github\.com:#https://github.com/#; s#\.git$##' || echo "")"
echo "path=$path"
echo "commit=$commit"
echo "date=$date"
echo "url=$remote"
