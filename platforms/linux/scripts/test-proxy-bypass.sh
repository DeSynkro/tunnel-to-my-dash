#!/usr/bin/env bash
# Regression test for Chromium's implicit loopback and link-local proxy bypass.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
exec "$ROOT/platforms/linux/scripts/run-electron-test.sh" \
  "$ROOT/desktop/scripts/test-proxy-bypass.mjs"
