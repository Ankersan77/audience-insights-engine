#!/usr/bin/env bash
# One command, one verdict for the project.
#
# Copy this into the initiative folder in the first epic and keep it there. Every
# epic `Gate` in implementation-plan.md is then literally `bash verify.sh`, which
# makes verification cost one turn instead of twelve: the build these rules come
# from spent 6-8 `npm run build` and 9-13 `tsc` invocations per epic because every
# executor assembled its own sequence.
#
#   bash verify.sh            # everything that applies to this project
#   bash verify.sh --fast     # skip the production build (per-task use only)
#
# Add project-specific steps at the bottom, never in the middle: the order is
# cheapest-first so a failure surfaces in seconds, not minutes.
set -uo pipefail
cd "$(dirname "$0")"

FAST=0
[ "${1:-}" = "--fast" ] && FAST=1

FAILED=()
run() {
  local label="$1"; shift
  printf '\n=== %s\n' "$label"
  if "$@"; then
    printf -- '--- %s: OK\n' "$label"
  else
    printf -- '--- %s: FAILED\n' "$label"
    FAILED+=("$label")
  fi
}

has_script() {
  [ -f package.json ] && node -e "process.exit(require('./package.json').scripts?.['$1'] ? 0 : 1)" 2>/dev/null
}

if [ -f package.json ]; then
  has_script check:source-of-truth && run "source-of-truth" npm run --silent check:source-of-truth
  has_script typecheck && run "type check" npm run --silent typecheck
  [ -f tsconfig.json ] && ! has_script typecheck && run "type check" npx --no-install tsc --noEmit
  has_script lint && run "lint" npm run --silent lint
  has_script test && run "tests" npm run --silent test -- --run
fi

if [ -f pyproject.toml ] || [ -f requirements.txt ]; then
  command -v ruff >/dev/null && run "ruff" ruff check .
  command -v pytest >/dev/null && run "pytest" pytest -q
fi

# --- project-specific gate steps go below this line -------------------------

# Migration check: src/db/schema.ts must match the committed drizzle/ migrations.
# `drizzle-kit generate` diffs the schema against the last migration snapshot
# without needing a live database connection; it reports "No schema changes"
# when they already match, and would otherwise write a new, uncommitted
# migration file — a sign schema.ts drifted ahead of drizzle/ (T4).
if [ -f drizzle.config.ts ]; then
  run "migration check (schema matches committed migrations)" sh -c \
    'npx --no-install drizzle-kit generate 2>&1 | tee /tmp/verify-db-generate.log | grep -q "No schema changes"'
fi

# Production build: the production build is the most expensive step, so it runs last
# and only in the full (non --fast) pass. A stale .next/ cache has produced a
# spurious Turbopack "binding to a port — Operation not permitted" panic on a
# long-idle checkout at least three times across this project's epics (each
# time confirmed unrelated to the code being verified, and each time resolved
# by clearing the cache) — clear it unconditionally before building so this
# stops costing a wasted dispatch and a false GATE: FAIL every time it recurs.
[ "$FAST" = 0 ] && rm -rf .next
[ "$FAST" = 0 ] && has_script build && run "pnpm build" npm run --silent build

printf '\n==========================\n'
if [ ${#FAILED[@]} -eq 0 ]; then
  echo "GATE: PASS"
  exit 0
fi
printf 'GATE: FAIL (%s)\n' "$(IFS=,; echo "${FAILED[*]}")"
exit 1
