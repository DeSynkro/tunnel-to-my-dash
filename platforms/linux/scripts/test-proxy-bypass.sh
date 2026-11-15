#!/usr/bin/env bash
# Regression test for Chromium's implicit loopback and link-local proxy bypass.
#
# Dashboard sessions set proxyBypassRules to "<-loopback>". Without it Chromium
# sends loopback and link-local requests directly, bypassing the app proxy and
# letting dashboard content reach local services. This test uses real local
# listeners and Electron's network stack. It needs a display; CI uses Xvfb.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
ELECTRON="$ROOT/desktop/node_modules/electron/dist/electron"
SCRIPT="$ROOT/desktop/scripts/test-proxy-bypass.mjs"

if [[ ! -x "$ELECTRON" ]]; then
  echo "error: Electron binary missing; run make desktop-deps" >&2
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
