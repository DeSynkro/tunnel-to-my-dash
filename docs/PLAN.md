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
func Run(ctx context.Context, tunnelCfg tunnel.Config, appCfg config.App, proxyAddr string) error
```

**Steps**

- [ ] End-to-end test: two userspace devices, an HTTP server on the server
      device, the proxy on the client device, and a normal `http.Client`
      configured with the proxy URL. Assert the body.
- [ ] Run `make test`; expect failure.
- [ ] Implement `app.Run` and the `run` subcommand:
      `ttmd-core run --tunnel <path> --config <path> [--proxy 127.0.0.1:0]`.
- [ ] Print the listening proxy address on startup.
- [ ] Handle SIGINT and SIGTERM; close the proxy and tunnel.
- [ ] Run `make test` and `make core`.
- [ ] Manual check with a real config:
      `curl -x http://127.0.0.1:<port> http://192.168.0.3:3000`.

**Commit:** `Run the tunnel and proxy from the core CLI`

## Task 7 — Privilege and no-TUN checks

**Files:** `Makefile`, `docs/SECURITY.md`

**Steps**

- [ ] Add `make check` running `go vet`, `gofmt -l`, and a grep that fails if
      `CreateTUN` appears in `core/`.
- [ ] Run the whole test suite as the normal user.
- [ ] Confirm `ip link` shows no new `tun` interface while the integration
      test runs.
- [ ] Record the result in `docs/SECURITY.md` if anything differs from the
      assumptions.

**Commit:** `Add core privilege and no-TUN checks`

## Phase 1 acceptance

- `make test` passes as a normal user.
- `make core` produces `build/ttmd-core`.
- `curl` through the proxy reaches an HTTP server over a userspace WireGuard
  tunnel.
- Public, loopback and multicast destinations are refused.
- The process creates no TUN device and needs no elevated privileges.
