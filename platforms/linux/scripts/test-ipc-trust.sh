#!/usr/bin/env bash
# Regression test for privileged IPC sender validation.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
exec "$ROOT/platforms/linux/scripts/run-electron-test.sh" \
  "$ROOT/desktop/scripts/test-ipc-trust.mjs"
