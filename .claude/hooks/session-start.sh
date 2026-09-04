#!/bin/bash
# Installs dependencies so a Claude Code on the web session can run the linter,
# the typechecks, the build and the tests immediately — without spending the first
# minutes of every session on `npm install`.
#
# Local machines already have node_modules, so this is a no-op outside the web.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}"

# `npm install` rather than `npm ci`: the container image is cached after this hook
# finishes, and install reuses an existing node_modules instead of deleting it first.
# Idempotent — safe to run on every session start.
npm install --no-audit --no-fund

# The Edge Functions run on Deno, not Vite, and `npm run check:functions` shells out
# to the `deno` binary that ships as a devDependency. Fail loudly here rather than
# leaving a typecheck that silently can't run.
if ! npx --no-install deno --version >/dev/null 2>&1; then
  echo "warning: the deno binary is missing — 'npm run check:functions' will not work" >&2
fi
