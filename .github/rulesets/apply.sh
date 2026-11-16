#!/usr/bin/env bash
set -euo pipefail

command -v gh >/dev/null 2>&1 || {
  echo "gh is required" >&2
  exit 1
}
command -v node >/dev/null 2>&1 || {
  echo "node is required" >&2
  exit 1
}

repo="${1:-}"
if [ -z "$repo" ]; then
  repo=$(gh repo view --json nameWithOwner --jq .nameWithOwner)
fi

case "$repo" in
  */*) ;;
  *)
    echo "usage: $0 [OWNER/REPO]" >&2
    exit 1
    ;;
esac

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
rulesets="$root/.github/rulesets"

for file in "$rulesets"/*.json; do
  name=$(node -e 'process.stdout.write(JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).name)' "$file")
  id=$(gh api "repos/$repo/rulesets" --jq ".[] | select(.name == \"$name\") | .id" | head -n 1)
  if [ -n "$id" ]; then
    echo "update $name ($id)"
    gh api --method PUT "repos/$repo/rulesets/$id" --input "$file" >/dev/null
  else
    echo "create $name"
    gh api --method POST "repos/$repo/rulesets" --input "$file" >/dev/null
  fi
done

echo "rulesets applied to $repo"
