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

- [ ] Go module and `ttmd-core` entry point
- [ ] LAN address classifier
- [ ] WireGuard config parser with private-range overrides
- [ ] Userspace WireGuard device and TCP dialer
- [ ] Localhost HTTP/CONNECT proxy
- [ ] End-to-end test through a userspace tunnel
- [ ] Manual `curl` check against a real endpoint
- [ ] Prove no TUN device and no elevated privileges

Done when a request can go `curl -> localhost proxy -> WireGuard -> LAN test
server`, public addresses are refused, and the whole test runs as a normal
user.

## Phase 2 — Vault, configuration and app lock core

- [ ] Argon2id + XChaCha20-Poly1305 vault
- [ ] Create, unlock, change password, export, import
- [ ] Password mode and convenience mode
- [ ] Config storage and validation
- [ ] Failed-attempt delay and lock semantics
- [ ] Tests for wrong passwords, tampering and permissions

Done when the core can store a tunnel config, lock and unlock it, and export
an encrypted copy, with no keyring dependency.

## Phase 3 — Electron shell

- [ ] Minimal TypeScript shell with no UI framework
- [ ] Lock screen and first-run setup
- [ ] Settings: tunnel, dashboard URL, internet toggle, external sites
- [ ] Sidecar lifecycle and local control socket
- [ ] Sandboxed dashboard view with proxy
- [ ] Navigation and permission restrictions
- [ ] Disable Chromium background networking and service hooks
- [ ] Error states: endpoint down, handshake timeout, blocked page
- [ ] Test against the real dashboard, Jellyfin and OpenCode

Done when the app opens the dashboard through the tunnel while the normal VPN
stays connected, and the network audit shows no unexpected traffic.

## Phase 4 — AppImage, portable data and updates

- [ ] AppImage with the Go core bundled
- [ ] Portable data directory beside the AppImage, with fallback
- [ ] Verify the Chromium sandbox works without `--no-sandbox`
- [ ] Signed checksums and release script
- [ ] CI: tests, build, dependency updates, network audit
- [ ] Manual update check without telemetry

Done when a fresh user can download one file, run it, and reach their
dashboard without installing anything else.

## Phase 5 — Real-world pass

- [ ] Dashboard at `192.168.0.3:3000`
- [ ] Jellyfin on the same host, different port
- [ ] OpenCode container
- [ ] Laptop dashboard at `192.168.0.4:3000`
- [ ] Normal VPN active for the whole session
- [ ] Remote network and home Wi-Fi
- [ ] Tunnel failure behaviour and reconnect

Done when the everyday use case works without touching the system VPN.

## Later

- Android app: Kotlin, Compose, system WebView, same Go core through gomobile.
- Windows portable build with the same Electron shell.
- Optional direct mode when already on the home LAN.
- Self-signed certificate trust for LAN HTTPS services.
- mDNS names such as `homeassistant.local`.
- Multiple saved tunnels or dashboards, if they earn their place.

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
