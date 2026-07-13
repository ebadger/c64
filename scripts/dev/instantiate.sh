#!/usr/bin/env bash
# instantiate.sh — stamp a new project out of this template.
#
# Replaces the small set of GLOBAL placeholder tokens (the ones that appear in many
# files with a single value) across all tracked text files. Per-file PROSE placeholders
# (e.g. {{DOMAIN}}, {{LENS_NAME}}, "{{One paragraph: ...}}") are left for you to fill in
# by hand — the script reports how many remain.
#
# Usage:
#   scripts/dev/instantiate.sh                 # interactive prompts
#   scripts/dev/instantiate.sh template.config # read KEY=VALUE lines from a file
#   scripts/dev/instantiate.sh --dry-run [...] # show what would change, write nothing
#
# Recognized GLOBAL tokens (KEY -> replaces {{KEY}} everywhere):
#   PROJECT_NAME        e.g. "Acme Widgets Platform"
#   CEO                 the owner/decision-maker handle, e.g. "ebadger"
#   REPO_SLUG           "owner/repo", e.g. "ebadger/acme"
#   DEFAULT_BRANCH      usually "main"
#   MISSION_ONE_LINER   one sentence for the session-start banner (optional)
#   STACK               one-line tech stack (optional)
#   PROD_URL            production URL if public (optional)
#   TEMPLATE_BASE_REF   exact AIProjectTemplate commit used (required unless directly cloned)
#   TEMPLATE_REVIEW_DATE initial lineage review date (defaults to today, UTC)
set -euo pipefail

KEYS="PROJECT_NAME CEO REPO_SLUG DEFAULT_BRANCH MISSION_ONE_LINER STACK PROD_URL TEMPLATE_BASE_REF TEMPLATE_REVIEW_DATE"
DRY_RUN=0
CONFIG=""

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    -h|--help) sed -n '2,30p' "$0"; exit 0 ;;
    *) CONFIG="$arg" ;;
  esac
done

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

# Collect KEY=VALUE pairs from a config file or interactive prompts.
declare -A VAL
if [ -n "$CONFIG" ]; then
  [ -f "$CONFIG" ] || { echo "ERROR: config file '$CONFIG' not found." >&2; exit 1; }
  while IFS='=' read -r k v; do
    case "$k" in ''|\#*) continue ;; esac
    k="$(printf '%s' "$k" | tr -d '[:space:]')"
    v="${v#"${v%%[![:space:]]*}"}"   # ltrim
    VAL["$k"]="$v"
  done < "$CONFIG"
else
  echo "Enter values (blank to leave a token unreplaced):"
  for k in $KEYS; do
    printf '  %s = ' "$k"
    read -r v || true
    [ -n "${v:-}" ] && VAL["$k"]="$v"
  done
fi

normalize_github_repo() {
  value=$1
  case "$value" in
    https://github.com/*) value=${value#https://github.com/} ;;
    git@github.com:*) value=${value#git@github.com:} ;;
    ssh://git@github.com/*) value=${value#ssh://git@github.com/} ;;
  esac
  value=${value%.git}
  printf '%s\n' "${value%/}"
}

# A direct clone can prove its exact template commit from HEAD. A GitHub-generated
# repository has unrelated history, so its source commit must be supplied explicitly;
# using today's upstream HEAD could skip changes made after the project was generated.
if [ -z "${VAL[TEMPLATE_BASE_REF]:-}" ] && [ -f ".template-source" ]; then
  template_repo=$(git config --file .template-source --get template.repository 2>/dev/null || true)
  origin_repo=$(git remote get-url origin 2>/dev/null || true)

  if [ -n "$template_repo" ] && [ -n "$origin_repo" ] &&
    [ "$(normalize_github_repo "$origin_repo")" = "$(normalize_github_repo "$template_repo")" ]; then
    template_ref=$(git rev-parse HEAD 2>/dev/null || true)
    if [ -n "$template_ref" ]; then
      VAL[TEMPLATE_BASE_REF]="$template_ref"
      echo "Detected template baseline from the direct clone: $template_ref"
    fi
  fi
fi

if [ -z "${VAL[TEMPLATE_BASE_REF]:-}" ]; then
  echo "ERROR: TEMPLATE_BASE_REF is required because the exact inherited commit cannot be proven." >&2
  echo "Set it to the AIProjectTemplate commit recorded when this specialization was created." >&2
  exit 1
fi
if [[ ! "${VAL[TEMPLATE_BASE_REF]}" =~ ^([0-9a-fA-F]{40}|[0-9a-fA-F]{64})$ ]]; then
  echo "ERROR: TEMPLATE_BASE_REF must be a full 40- or 64-character commit ID." >&2
  exit 1
fi

if [ -z "${VAL[TEMPLATE_REVIEW_DATE]:-}" ]; then
  VAL[TEMPLATE_REVIEW_DATE]="$(date -u +%Y-%m-%d)"
fi
if [[ ! "${VAL[TEMPLATE_REVIEW_DATE]}" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
  echo "ERROR: TEMPLATE_REVIEW_DATE must use YYYY-MM-DD format." >&2
  exit 1
fi

# Build the list of files to process: tracked text files, excluding this script and .git.
FILES=$(git ls-files | grep -v -E '^scripts/dev/instantiate\.sh$' || true)
if [ -z "$FILES" ]; then
  echo "ERROR: no tracked files found." >&2
  echo "Run instantiation before deleting template history, or git-add the template files first." >&2
  exit 1
fi

echo ""
echo "Tokens to replace:"
for k in $KEYS; do
  [ -n "${VAL[$k]:-}" ] && echo "  {{$k}} -> ${VAL[$k]}"
done
echo ""

changed=0
for f in $FILES; do
  # Skip obvious binaries.
  case "$f" in *.png|*.jpg|*.jpeg|*.gif|*.ico|*.pdf|*.zip|*.gz) continue ;; esac
  for k in $KEYS; do
    val="${VAL[$k]:-}"
    [ -z "$val" ] && continue
    if grep -q "{{$k}}" "$f" 2>/dev/null; then
      if [ "$DRY_RUN" = "1" ]; then
        echo "would update: $f ({{$k}})"
      else
        KEY="$k" VALUE="$val" perl -0777 -pi -e 's/\Q{{$ENV{KEY}}}\E/$ENV{VALUE}/g' "$f"
      fi
      changed=1
    fi
  done
done

echo ""
if [ "$DRY_RUN" = "1" ]; then
  echo "Dry run complete. No files written."
else
  [ "$changed" = "1" ] && echo "Global tokens replaced." || echo "No global tokens found to replace."
fi

# Report remaining prose placeholders so you know what's left to fill in by hand.
remaining=$(git grep -l '{{' -- . ':!scripts/dev/instantiate.sh' 2>/dev/null || true)
if [ -n "$remaining" ]; then
  echo ""
  echo "Files still containing {{...}} prose placeholders to fill in by hand:"
  printf '%s\n' "$remaining" | sed 's/^/  - /'
  echo ""
  echo "These are intentional author-fill spots (mission text, spec contracts, lens roles)."
fi

echo ""
echo "Next: see SETUP.md for the remaining bootstrap steps (install hooks, fill specs, etc.)."
