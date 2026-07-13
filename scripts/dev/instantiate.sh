#!/usr/bin/env bash
# Stamp global placeholders and establish exact template lineage.
set -euo pipefail

KEYS="PROJECT_NAME CEO REPO_SLUG DEFAULT_BRANCH STACK PROD_URL TEMPLATE_BASE_REF TEMPLATE_REVIEW_DATE"
DRY_RUN=0
CONFIG=""

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    -h|--help) sed -n '1,30p' "$0"; exit 0 ;;
    *) CONFIG="$arg" ;;
  esac
done

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

declare -A VAL
if [ -n "$CONFIG" ]; then
  [ -f "$CONFIG" ] || { echo "ERROR: config file '$CONFIG' not found." >&2; exit 1; }
  while IFS='=' read -r k v; do
    case "$k" in ''|\#*) continue ;; esac
    k="$(printf '%s' "$k" | tr -d '[:space:]')"
    v="${v#"${v%%[![:space:]]*}"}"
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
  echo "ERROR: TEMPLATE_BASE_REF is required because the inherited commit cannot be proven." >&2
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

FILES=$(git ls-files | grep -v -E '^scripts/dev/instantiate\.sh$' || true)
if [ -z "$FILES" ]; then
  echo "ERROR: no tracked files found; instantiate before deleting template history." >&2
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
  [ "$changed" = "1" ] && echo "Global tokens replaced." || echo "No global tokens found."
fi

remaining=$(git grep -l '{{' -- . ':!scripts/dev/instantiate.sh' 2>/dev/null || true)
if [ -n "$remaining" ]; then
  echo ""
  echo "Files still containing prose placeholders:"
  printf '%s\n' "$remaining" | sed 's/^/  - /'
fi

echo ""
echo "Next: see SETUP.md."
