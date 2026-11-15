#!/usr/bin/env bash
# Run an Electron regression script with the project's Electron binary.
#
# Scripts are expected at paths relative to the repository. A display is
# required; CI uses Xvfb, and this wrapper starts Xvfb when DISPLAY is unset.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
ELECTRON="$ROOT/desktop/node_modules/electron/dist/electron"
SCRIPT="${1:-}"

if [[ -z "$SCRIPT" ]]; then
  echo "usage: run-electron-test.sh <script>" >&2
  exit 2
fi
if [[ ! -x "$ELECTRON" ]]; then
  echo "error: Electron binary missing; run make desktop-deps" >&2
  exit 1
fi
if [[ ! -f "$SCRIPT" ]]; then
  echo "error: test script not found: $SCRIPT" >&2
  exit 1
fi

export NODE_OPTIONS="--disable-warning=MODULE_TYPELESS_PACKAGE_JSON"
cd "$ROOT/desktop"

if [[ -n "${DISPLAY:-}" ]]; then
  exec "$ELECTRON" --no-sandbox --disable-gpu --disable-dev-shm-usage "$SCRIPT"
fi

if ! command -v xvfb-run >/dev/null 2>&1; then
  echo "error: xvfb-run is required without DISPLAY" >&2
  exit 1
fi

exec xvfb-run -a "$ELECTRON" --no-sandbox --disable-gpu --disable-dev-shm-usage "$SCRIPT"
