# Linux

The released artifact is the AppImage:

```bash
make appimage
make checksums
```

Output stays in `desktop/release/`.

Linux-only helpers live in `scripts/`:

- `toolchain.sh` downloads and verifies the pinned Go toolchain.
- `audit-network.sh` starts the app with no vault or profile and fails on any
  non-loopback TCP/UDP traffic. CI uses strace; local runs can fall back to
  `ss`.
