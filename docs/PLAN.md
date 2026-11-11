# Phase 1 Plan — Tunnel and Proxy

Goal: prove the hard part before any UI. A command-line core that connects to
a WireGuard endpoint in userspace, dials a LAN address through it, and serves
that connection through a localhost proxy.

Scope: Phase 0 remainder (pinned toolchain) and Phase 1. Vault, Electron and
packaging get their own plans once this works.

## Ground rules

- All commands run from the repository root.
- The Makefile exports project-local caches (`.cache/`, `.tmp/`).
- The Go toolchain lives in `.tools/` and is not installed globally.
- Tests run as an ordinary user. Any need for root is a design failure.
- Test keys are generated at runtime. No real configs or keys in git.
- One task, one commit, under DeSynkro.

## Files

```
core/
  go.mod
  cmd/ttmd-core/main.go
  cmd/ttmd-core/main_test.go
  internal/app/app.go
  internal/config/config.go
  internal/config/config_test.go
  internal/lan/lan.go
  internal/lan/lan_test.go
  internal/proxy/proxy.go
  internal/proxy/proxy_test.go
  internal/tunnel/tunnel.go
  internal/tunnel/netstack.go
  internal/tunnel/dial.go
  internal/tunnel/tunnel_test.go
  internal/tunnel/testpair_test.go
scripts/
  toolchain.sh
```

## Task 0 — Pin the Go toolchain

**Files:** `.go-version`, `scripts/toolchain.sh`, `Makefile`

**Steps**

- [x] Write `.go-version` containing `go1.27.4`.
- [x] Write `scripts/toolchain.sh`:
  - Reads the version from `.go-version`.
  - Detects `x86_64` or `aarch64`.
  - Downloads `go1.27.4.linux-<arch>.tar.gz` from `https://go.dev/dl/`.
  - Verifies the official SHA-256 before extracting:
    - amd64: `7226736c2339719cda28fbf3a54d71aa63bcefe376e98cef00034268dab24840`
    - arm64: `3392582988a273a87ab5043ee1b2c9c17a2c3c00580bf9326c47a2e0aaaeac92`
  - Extracts to `.tools/go`, replacing any previous copy.
  - Prints `go version go1.27.4 linux/<arch>`.
- [x] Add to `Makefile`: `GO := $(ROOT)/.tools/go/bin/go`, `.tools/go/bin` on
      `PATH`, a `toolchain` target, and `fmt`, `test`, `core` targets.
- [x] Run `make toolchain`.
- [x] Run `./.tools/go/bin/go version`.

**Check:** output is `go version go1.27.4 linux/amd64`.

**Commit:** `Pin the Go toolchain inside the project`

## Task 1 — Go module and CLI skeleton

**Files:** `core/go.mod`, `core/cmd/ttmd-core/main.go`,
`core/cmd/ttmd-core/main_test.go`

**Interface**

```go
func run(args []string, stdout io.Writer) int
```

**Steps**

- [x] Test: `run([]string{"-version"}, &buf)` returns `0` and prints
      `ttmd-core 0.0.0-dev`.
- [x] Run `make test`; expect a build failure because the package does not
      exist.
- [x] Create the module `github.com/desynkro/tunnel-to-my-dash/core` with Go
      1.27.
- [x] Implement `main.go` with a `-version` flag and `os.Exit(run(...))`.
- [x] Run `make test`; expect pass.
- [x] Run `make core` and `./build/ttmd-core -version`.

**Commit:** `Add the core module and CLI entry point`

## Task 2 — LAN address classifier

**Files:** `core/internal/lan/lan.go`, `core/internal/lan/lan_test.go`

**Interface**

```go
func IsLAN(ip net.IP) bool
func IsLoopback(ip net.IP) bool
func DefaultAllowedIPs() []net.IPNet
```

`IsLAN` is true for RFC1918 IPv4 and IPv6 ULA (`fc00::/7`). It is false for
loopback, link-local, multicast, unspecified and public addresses.
`DefaultAllowedIPs` returns the ranges the tunnel is allowed to carry,
regardless of what the imported WireGuard config says.

**Steps**

- [x] Table test: `192.168.0.3`, `10.1.2.3`, `172.16.0.1`, `172.31.255.254`
      and `fd00::1` are LAN; `172.32.0.1`, `127.0.0.1`, `169.254.1.1`,
      `8.8.8.8`, `::1`, `fe80::1`, `224.0.0.1` and `nil` are not.
- [x] Run `make test`; expect failure.
- [x] Implement the classifier and the default ranges.
- [x] Run `make test`; expect pass.

**Commit:** `Add LAN address classification`

## Task 3 — Configuration

**Files:** `core/internal/config/config.go`,
`core/internal/config/config_test.go`

**Interface**

```go
type Tunnel struct {
    PrivateKey     wgtypes.Key
    PeerPublicKey  wgtypes.Key
    PresharedKey   *wgtypes.Key
    Endpoint       string
    Addresses      []net.IPNet
    DNS            []net.IP
    MTU            int
}

type App struct {
    DashboardURL  string `json:"dashboard_url"`
    AllowExternal bool   `json:"allow_external"`
}

func LoadTunnel(path string) (Tunnel, error)
func LoadApp(path string) (App, error)
func (a App) Validate() error
```

The tunnel parser reads the standard WireGuard INI format. One peer only for
now. `Endpoint` and `PrivateKey` are required; `MTU` defaults to `1420`.
`AllowedIPs` from the file is deliberately ignored for routing; the tunnel
uses `lan.DefaultAllowedIPs()`.

The app config is JSON. `DashboardURL` must be `http` or `https`, and its host
must be a private IP literal in this phase. Hostnames come later with a DNS
design.

**Steps**

- [x] Tests: round-trip a generated config; missing private key; bad base64;
      missing endpoint; two peers; bad URL scheme; public dashboard IP.
- [x] Run `make test`; expect failure.
- [x] Add the `wgctrl` dependency and implement the parser.
- [x] Run `make test`; expect pass.
- [x] Confirm private keys never appear in error strings.

**Commit:** `Parse WireGuard and app configuration`

## Task 4 — Userspace WireGuard device

**Files:** `core/internal/tunnel/tunnel.go`,
`core/internal/tunnel/netstack.go`, `core/internal/tunnel/dial.go`,
`core/internal/tunnel/tunnel_test.go`,
`core/internal/tunnel/testpair_test.go`

**Interface**

```go
type Config struct {
    PrivateKey    wgtypes.Key
    PeerPublicKey wgtypes.Key
    PresharedKey  *wgtypes.Key
    Endpoint      string
    Addresses     []net.IPNet
    MTU           int
    ListenPort    uint16 // 0 picks a random port
}

type Device struct{ /* ... */ }

func Start(cfg Config) (*Device, error)
func (d *Device) DialContext(ctx context.Context, network, address string) (net.Conn, error)
func (d *Device) Listen(network, address string) (net.Listener, error)
func (d *Device) Close() error
```

The device is wireguard-go with a gVisor netstack behind a custom `tun.Device`
adapter. No OS TUN device is opened. TCP dials come from `gonet`.

**Steps**

- [x] Write a test pair helper: two devices on `127.0.0.1` linked to each
      other's UDP endpoint, addresses `10.66.0.1/24` and `10.66.0.2/24`.
- [x] Test: start a TCP echo listener on `10.66.0.1:8080`; dial it from the
      other device; send `hello`; expect the echo. Retry the dial for up to
      five seconds while the handshake completes.
- [x] Run `make test`; expect failure.
- [x] Implement the netstack, adapter and device lifecycle.
- [x] Run `make test`; expect pass.
- [x] Test `Close` twice and after the peer disappears.
- [x] Resolve a hostname endpoint to an IP before configuring wireguard-go.

**Commit:** `Add the userspace WireGuard device`

## Task 5 — Localhost proxy

**Files:** `core/internal/proxy/proxy.go`, `core/internal/proxy/proxy_test.go`

**Interface**

```go
type Dialer interface {
    DialContext(ctx context.Context, network, address string) (net.Conn, error)
}

type Policy interface {
    Allow(host, port string) error
}

type Server struct{ /* ... */ }

func New(dialer Dialer, policy Policy) *Server
func (s *Server) Start() (net.Addr, error)
func (s *Server) Close() error
```

The server binds `127.0.0.1:0` and returns its address. Plain HTTP requests
use `httputil.ReverseProxy` with a transport that dials through the tunnel.
`CONNECT` is handled manually. WebSocket upgrades pass through.

**Steps**

- [x] Tests with a fake dialer:
      - HTTP GET returns the upstream body.
      - Public and loopback targets return 403 and never call the dialer.
      - `CONNECT` carries raw bytes to an echo server.
      - WebSocket echo works through the proxy.
- [x] Run `make test`; expect failure.
- [x] Implement the proxy and policy.
- [x] Run `make test`; expect pass.
- [x] Confirm `Proxy-Authorization` and `Proxy-Connection` are not forwarded
      and hop-by-hop headers are stripped.

**Commit:** `Add the localhost LAN proxy`

## Task 6 — CLI and end-to-end test

**Files:** `core/internal/app/app.go`, `core/cmd/ttmd-core/main.go`,
`core/cmd/ttmd-core/main_test.go`

**Interface**

```go
type App struct{ /* ... */ }

func Start(cfg config.Tunnel) (*App, error)
func (a *App) ProxyAddr() net.Addr
func (a *App) Close() error
```

**Steps**

- [x] End-to-end test: two userspace devices, an HTTP server on the server
      device, the proxy on the client device, and a normal `http.Client`
      configured with the proxy URL. Assert the body.
- [x] Run `make test`; expect failure.
- [x] Implement `app.Start` and the `run` subcommand:
      `ttmd-core run --tunnel <path> --config <path>`.
- [x] Print the listening proxy address on startup.
- [x] Handle SIGINT and SIGTERM; close the proxy and tunnel.
- [x] Run `make test` and `make core`.
- [x] Manual check with a real config:
      `curl -x http://127.0.0.1:<port> http://192.168.0.3:3000` returned
      HTTP 200 through the home endpoint while ProtonVPN was active.

**Commit:** `Run the tunnel and proxy from the core CLI`

## Task 7 — Privilege and no-TUN checks

**Files:** `Makefile`, `docs/SECURITY.md`

**Steps**

- [x] Add `make check` running `go vet`, `gofmt -l`, and a grep that fails if
      `CreateTUN` appears in `core/`.
- [x] Run the whole test suite as the normal user.
- [x] Confirm `ip link` shows no new `tun` interface while the integration
      test runs.
- [x] Record the result in `docs/SECURITY.md` if anything differs from the
      assumptions. Nothing differed.

**Commit:** `Add core privilege and no-TUN checks`

## Phase 1 acceptance

- `make test` passes as a normal user.
- `make core` produces `build/ttmd-core`.
- `curl` through the proxy reaches an HTTP server over a userspace WireGuard
  tunnel.
- Public, loopback and multicast destinations are refused.
- The process creates no TUN device and needs no elevated privileges.

## Phase 2 — Vault and profiles

Goal: an encrypted store for multiple profiles, unlocked by a password or a
`0600` key file, with no OS keyring. No UI in this phase.

### Files

- `core/internal/vault/crypto.go` — random bytes, Argon2id, XChaCha20-Poly1305
  and base64 helpers.
- `core/internal/vault/vault.go` — metadata, create/open/unlock/lock and atomic
  save.
- `core/internal/vault/profile.go` — profile and data types, validation and
  CRUD.
- `core/internal/vault/export.go` — encrypted export and import.
- Tests alongside each file.

### Format

`vault.json` holds plaintext metadata: version, mode, KDF parameters, salt,
wrapped vault key, payload nonce and ciphertext. The encrypted payload is a
`Data` document:

```json
{
  "version": 1,
  "active_profile": "...",
  "profiles": [
    {
      "id": "...",
      "name": "Home",
      "tunnel_config": "...raw WireGuard config...",
      "dashboard_url": "http://192.168.0.3:3000",
      "allow_external": false,
      "external_origins": []
    }
  ]
}
```

The raw WireGuard text is stored encrypted and parsed on demand with
`config.ParseTunnel`. The vault key is random. Password mode wraps it with an
Argon2id-derived key; keyfile mode stores it in `vault.key` with `0600`.

### Tasks

1. Crypto and vault lifecycle
   - [x] Argon2id parameters: time 3, memory 64 MiB, threads 2, 32-byte key.
   - [x] Create a password vault, lock, reopen, reject a wrong password,
     accept the right one.
   - [x] Tampered ciphertext fails cleanly.
   - [x] Atomic writes and `0600` permissions.
   - [x] Lockout after repeated failures with an increasing delay.
   - Commit: `Add the encrypted vault core`

2. Profiles
   - [x] `Profile` and `Data` with stable random IDs.
   - [x] Add, update, delete and set active; duplicate and missing IDs
     rejected.
   - [x] Validate name, tunnel text and dashboard URL.
   - [x] The first profile becomes active; deleting the active profile picks
     another.
   - Commit: `Add vault profiles`

3. Keyfile mode and password changes
   - [x] Create and open a vault with a `0600` key file.
   - [x] Reject a key file with group or other permissions.
   - [x] Change the password and convert password ↔ keyfile.
   - Commit: `Add vault keyfile mode and password changes`

4. Export and import
   - [x] Export the payload with a separate Argon2id password.
   - [x] Import with the right password; reject a wrong one.
   - Commit: `Add vault export and import`

### Acceptance

- [x] `make check` passes.
- [x] A password vault round-trips profiles after lock and unlock.
- [x] Wrong passwords and tampered ciphertext are rejected.
- [x] Keyfile mode works with `0600` and rejects looser permissions.
- [x] Export and import round-trip without exposing keys.
- [x] No OS keyring, no plaintext private keys on disk.

## Phase 3 — Electron shell

Goal: a working Linux desktop app that creates or unlocks the vault, imports
a profile, starts the tunnel and opens the dashboard. LAN-only by default,
with opt-in exact external origins for fonts and widgets.

### UX

- First run: create the vault (optional password), import or paste a
  WireGuard config, name the profile, set the dashboard URL.
- Lock: unlock with the password; keyfile vaults open directly.
- Main: profile list, connect/disconnect, lock, add profile, edit profile,
  settings.
- Dashboard: a sandboxed `BaseWindow` with a 36px toolbar (App, back,
  forward, reload, Home and host label) above a `WebContentsView`. Closing it
  disconnects the tunnel.

### Architecture

- The Go core gets a `serve` command. It opens the vault and listens on
  `<data-dir>/control.sock` with a small HTTP/JSON API, socket mode `0600`.
- Endpoints: status, vault create/unlock/lock/password, profile CRUD and
  activate, connect and disconnect.
- Responses never include `tunnel_config` or private keys.
- The Electron main process is the only control client. The renderer talks to
  it through a narrow preload bridge.
- The dashboard session uses `persist:profile-<id>` and
  `session.setProxy` pointing at the core's localhost proxy.
- The data directory is next to the AppImage or portable exe when writable,
  otherwise the normal user data directory. Development uses
  `local/dev-data`.

### Security

- Shell renderer: context isolation, sandbox, no Node integration.
- Dashboard: no preload, no Node, sandbox, context isolation, permissions
  denied, `window.open` denied.
- Chromium background networking and known Google services disabled with
  command-line switches, then audited.
- External content is off by default. A profile may opt into all public
  origins or an exact origin list; those use a direct dialer and the normal
  network or VPN, never the tunnel. Top-level navigation stays private-only.

### Tasks

- [x] 1. Core control server with a fake connector in tests.
   Commit: `Add the core control server`
- [x] 2. `serve` command and Unix socket lifecycle.
   Commit: `Add the core serve command`
- [x] 3. Desktop scaffold: TypeScript, esbuild, Electron, build and start scripts.
   Commit: `Add the desktop app skeleton`
- [x] 4. Setup, lock and profile UI through the preload bridge.
   Commit: `Add the desktop setup and lock screens`
- [x] 5. Dashboard child window with a session partition and proxy.
   Commit: `Open the dashboard through the tunnel`
- [x] 6. Hardening, no-phone-home switches and a real endpoint pass.
   Commit: `Harden the desktop shell`
- [x] 7. External-content routing: exact origins, a public-address-only direct
   dialer and the per-profile settings panel.
   Commit: `Add opt-in external content`

### Acceptance

- [x] First run creates a vault and a profile from a `.conf` file.
- [x] Lock and unlock work.
- [x] Connect opens the dashboard while ProtonVPN is active.
- [x] Closing the dashboard disconnects the tunnel.
- [x] Auto-hiding dashboard toolbar with back, forward, reload, home and App;
  private LAN links navigate in the same view and public URLs stay blocked.
- [x] Settings page for profile names, dashboard URLs and the app lock, with
  confirm-password checks on setup and password changes.
- [x] External content is off by default; allow-all and exact-origin modes
  both load directly, and unlisted origins are refused in exact mode.
- [x] No Node in the shell renderer or dashboard; no permission prompts.
- [x] `make check` passes and the desktop code type-checks.
- [x] No unexpected outbound traffic beyond the WireGuard endpoint.

Desktop pass complete. Jellyfin and OpenCode were checked in the Phase 5
network pass. Remaining: friendly tunnel error pages.

## Phase 4 — Linux AppImage

- [x] electron-builder AppImage with the Go core in `resources/ttmd-core`
- [x] Portable `tunnel-to-my-dash-data/` beside the AppImage, with fallback
- [x] Chromium sandbox verified without `--no-sandbox`
- [x] SHA-256 checksums and `make release`
- [x] Real AppImage pass against the home dashboard
- [x] CI workflow and Dependabot (first hosted run pending)
- [x] Manual update path documented, no update pings
- [ ] GPG-signed release artifacts
- [ ] Automated network audit in CI

Artifact: `desktop/release/Tunnel-to-My-Dash-0.1.0-x86_64.AppImage`.

## Phase 5 — Real-world network pass

Goal: prove the everyday case against the real services, with the normal VPN
still connected.

- [x] Jellyfin on `192.168.0.3:8096`: HTTP 200, redirected to `/web/`,
      title `Jellyfin`.
- [x] OpenCode on `192.168.0.3:4096`: HTTP 200.
- [x] Laptop dashboard on `192.168.0.4:3000`: HTTP 200, 102646 bytes.
- [x] ProtonVPN active throughout; no TUN device, root or route changes.
- [ ] Jellyfin playback inside Chromium, including transcoding.
- [ ] Home Wi-Fi and remote-network behaviour, including NAT loopback.
- [ ] Tunnel failure behaviour and reconnect.

All checks above ran through `ttmd-core run` and its localhost proxy as an
ordinary user. The remaining items need UI-level or different-network tests.
