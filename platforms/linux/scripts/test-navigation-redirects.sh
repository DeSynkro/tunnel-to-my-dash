#!/usr/bin/env bash
# Regression test for dashboard navigation policy on redirects and meta refresh.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
exec "$ROOT/platforms/linux/scripts/run-electron-test.sh" \
  "$ROOT/desktop/scripts/test-navigation-redirects.mjs"
