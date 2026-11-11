# Roadmap

This is the build order. Each phase ends with something we can run and test.
Later phases do not start until the current one works.

## Phase 0 — Repository and docs

- [x] Git repository, license and `.gitignore`
- [x] README, design, security notes
- [x] Project-local build environment (`.cache/`, `.tmp/`)
- [x] Pin the Go toolchain under `.tools/`
- [x] First commit

Done when `make env` works, the docs are committed, and no secrets or build
artifacts are tracked.

## Phase 1 — Tunnel and proxy proof

No UI yet. A command-line core that proves the hard part.

- [x] Go module and `ttmd-core` entry point
- [x] LAN address classifier
- [x] WireGuard config parser
- [x] Userspace WireGuard device and TCP dialer
- [x] Route only private ranges through the tunnel
- [x] Localhost HTTP/CONNECT proxy
- [x] CLI wiring and signal handling
- [x] End-to-end test through a userspace tunnel
- [x] Manual `curl` check against a real endpoint
- [x] Prove no TUN device and no elevated privileges

Done when a request can go `curl -> localhost proxy -> WireGuard -> LAN test
server`, public addresses are refused, and the whole test runs as a normal
user.

Phase 1 complete: HTTP 200 from `192.168.0.3:3000` through the home endpoint
with ProtonVPN active.

## Phase 2 — Vault, configuration and app lock core

- [x] Argon2id + XChaCha20-Poly1305 vault
- [x] Create, unlock, change password, export, import
- [x] Password mode and convenience mode
- [x] Config storage and validation
- [x] Profile records with stable IDs, even if the first UI creates one
- [x] Failed-attempt delay and lock semantics
- [x] Tests for wrong passwords, tampering and permissions

Done when the core can store a tunnel config, lock and unlock it, and export
an encrypted copy, with no keyring dependency.

Phase 2 complete: password and keyfile vaults, profile CRUD, password changes,
export/import, lockout and tamper checks.

## Phase 3 — Electron shell

- [x] Minimal TypeScript shell with no UI framework
- [x] Lock screen and first-run setup
- [x] Settings for the tunnel and dashboard URL
- [ ] Internet toggle and external-site panel (deferred; proxy is LAN-only)
- [x] Sidecar lifecycle and local control socket
- [x] Sandboxed dashboard window with proxy
- [x] Dashboard service tiles open in-app for private http(s) URLs
- [x] Navigation bar with back, forward, reload, home and App
- [x] Navigation and permission restrictions
- [x] Disable Chromium background networking, DNS and service hooks
- [ ] Friendly error pages for endpoint and handshake failures
- [x] Test against the real dashboard
- [ ] Test Jellyfin and OpenCode

Done when the app opens the dashboard through the tunnel while the normal VPN
stays connected, and the network audit shows no unexpected traffic.

Desktop dashboard pass complete. Remaining Phase 3 items are the deferred
internet toggle and the Jellyfin/OpenCode checks.

## Phase 4 — AppImage, portable data and updates

- [x] AppImage with the Go core bundled
- [x] Portable data directory beside the AppImage, with fallback
- [x] Verify the Chromium sandbox works without `--no-sandbox`
- [x] SHA-256 checksums and `make release`
- [x] CI workflow, AppImage build and dependency updates (first hosted run
      pending)
- [x] Manual update path without telemetry
- [ ] GPG-signed release artifacts
- [ ] Automated network audit in CI

Done when a fresh user can download one file, run it, and reach their
dashboard without installing anything else.

Phase 4 complete on Linux: the packaged AppImage loaded the real dashboard
with portable data beside it and the Chromium sandbox enabled.

## Phase 5 — Real-world pass

- [x] Dashboard at `192.168.0.3:3000`
- [x] Jellyfin on the same host, different port
- [x] OpenCode container
- [x] Laptop dashboard at `192.168.0.4:3000`
- [x] Normal VPN active for the whole session
- [ ] Remote network and home Wi-Fi
- [ ] Tunnel failure behaviour and reconnect

Done when the everyday use case works without touching the system VPN.

Phase 5 network pass: with ProtonVPN active, requests through the core
proxy returned HTTP 200 from Jellyfin (`/web/`, title `Jellyfin`), OpenCode
and the laptop dashboard (`192.168.0.4:3000`, 102646 bytes). Jellyfin
playback inside Chromium is untested, and the home Wi-Fi, remote-network and
reconnect cases are still open.

## Later

- Android app: Kotlin, Compose, system WebView, same Go core through gomobile.
- Windows portable build with the same Electron shell.
- Optional direct mode when already on the home LAN.
- Self-signed certificate trust for LAN HTTPS services.
- mDNS names such as `homeassistant.local`.
- Profile switcher for multiple tunnels/dashboards. The vault schema supports
  this from Phase 2; the picker is a UI feature.

## Open questions

- Jellyfin playback quality inside Chromium, especially transcoding.
- Home Wi-Fi NAT loopback: always tunnel, or detect and go direct?
- How much of Chromium's background surface can be removed before the audit
  is clean enough?
- Whether the app lock should also lock on idle, or only on launch and
  background.
- Whether to ship the portable data folder next to the AppImage as the default
  or as an explicit `--portable` flag.

## Working agreement

- Small steps, each with a check or test.
- Commits under DeSynkro, one logical change per commit.
- Build caches and temporary files stay inside the project.
- No real configs, keys or vaults in git.
