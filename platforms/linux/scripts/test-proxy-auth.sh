#!/usr/bin/env bash
# Regression test for desktop local-proxy authentication.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
exec "$ROOT/platforms/linux/scripts/run-electron-test.sh" \
  "$ROOT/desktop/scripts/test-proxy-auth.mjs"
