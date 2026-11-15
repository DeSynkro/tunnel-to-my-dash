#!/usr/bin/env bash
# Regression test for clearing dashboard cookies, storage and cache state.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
exec "$ROOT/platforms/linux/scripts/run-electron-test.sh" \
  "$ROOT/desktop/scripts/test-browser-state.mjs"
