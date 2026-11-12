#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
VERSION="$(tr -d '[:space:]' < "$ROOT/.go-version")"
TOOLS="$ROOT/.tools"
DOWNLOADS="$TOOLS/downloads"

if [[ -z "$VERSION" ]]; then
  echo "error: .go-version is empty" >&2
  exit 1
fi

case "$(uname -s)" in
  Linux) ;;
  *)
    echo "error: this script currently supports Linux only" >&2
    exit 1
    ;;
esac

case "$(uname -m)" in
  x86_64 | amd64) GOARCH=amd64 ;;
  aarch64 | arm64) GOARCH=arm64 ;;
  *)
    echo "error: unsupported architecture: $(uname -m)" >&2
    exit 1
    ;;
esac

case "$VERSION/$GOARCH" in
  go1.27.4/amd64) EXPECTED=7226736c2339719cda28fbf3a54d71aa63bcefe376e98cef00034268dab24840 ;;
  go1.27.4/arm64) EXPECTED=3392582988a273a87ab5043ee1b2c9c17a2c3c00580bf9326c47a2e0aaaeac92 ;;
  *)
    echo "error: no checksum recorded for $VERSION on $GOARCH" >&2
    echo "update scripts/toolchain.sh before changing .go-version" >&2
    exit 1
    ;;
esac

if [[ -x "$TOOLS/go/bin/go" ]] && "$TOOLS/go/bin/go" version 2>/dev/null | grep -q " $VERSION "; then
  "$TOOLS/go/bin/go" version
  exit 0
fi

for cmd in curl sha256sum tar; do
  if ! command -v "$cmd" >/dev/null; then
    echo "error: missing required command: $cmd" >&2
    exit 1
  fi
done

mkdir -p "$TOOLS" "$DOWNLOADS"
ARCHIVE="$DOWNLOADS/$VERSION.linux-$GOARCH.tar.gz"
EXTRACT="$TOOLS/.extract.$$"

cleanup() {
  rm -rf "$EXTRACT"
}
trap cleanup EXIT

echo "Downloading $VERSION for linux/$GOARCH"
curl --fail --location --retry 3 --output "$ARCHIVE" \
  "https://go.dev/dl/$VERSION.linux-$GOARCH.tar.gz"

printf '%s  %s\n' "$EXPECTED" "$ARCHIVE" | sha256sum --check --status - || {
  echo "error: checksum mismatch for $ARCHIVE" >&2
  rm -f "$ARCHIVE"
  exit 1
}

mkdir -p "$EXTRACT"
tar -C "$EXTRACT" -xzf "$ARCHIVE"
rm -rf "$TOOLS/go"
mv "$EXTRACT/go" "$TOOLS/go"
rm -f "$ARCHIVE"

"$TOOLS/go/bin/go" version
