# Design

## Summary

Tunnel to My Dash is a Linux desktop app (Android and Windows later) that
opens a self-hosted LAN dashboard through a WireGuard tunnel owned by the app.
It is not a VPN client for the whole machine. The tunnel lives inside the app,
the browser can only reach the LAN, and the system VPN is untouched.

Working name: Tunnel to My Dash. Short name in code and paths: `ttmd`.

## The problem

Self-hosted services usually live on a private network, reachable through a
WireGuard endpoint at home. With another VPN running, the usual routine is to
disable it, bring up WireGuard, do the thing, then switch everything back.
That is slow, easy to forget, and interrupts whatever else the machine is
doing.

The app should make the tunnel an implementation detail. Open it, get the
dashboard. Close it, and the tunnel is gone.

## Goals

- Open one configured dashboard from anywhere, with as few steps as possible.
- Keep the user's normal VPN and routing table untouched.
- Never require root, a system VPN slot, or a kernel module.
- Strict LAN-only browsing by default.
- Optional external content for dashboards that use CDN fonts or client-side
  widgets, with clear controls and a record of what was contacted.
- No telemetry, analytics, accounts or cloud dependencies.
- Portable desktop data and an encrypted vault for secrets.
- Linux AppImage first. Android and Windows afterwards, reusing the same core.

## Non-goals

- A general-purpose web browser.
- A system-wide VPN client.
- A WireGuard server. Users bring their own endpoint and config.
- Cloud sync, remote access to the app, or multi-user accounts.
- Guaranteed playback in every embedded media player. Jellyfin is a target,
  not a promise for the first release.
- iOS or macOS at this stage.

## Architecture

```
┌──────────────────────────── App ────────────────────────────┐
│                                                             │
│  Lock / settings (Electron)         Dashboard (Chromium)    │
│             │                               │                │
│             │ control                       │ HTTP(S)        │
│             ▼                               ▼                │
│      Go core sidecar  ◄──────────  localhost proxy          │
│             │                                               │
│             │ WireGuard, userspace                          │
└─────────────┼───────────────────────────────────────────────┘
              │ UDP
       home WireGuard endpoint
              │
       192.168.0.0/24
```

The desktop app has four parts:

- **Electron main process.** Window, lock screen, settings, data directory,
  and the lifecycle of the Go core. No remote content runs with Node access.
- **Dashboard view.** A separate sandboxed `WebContentsView` with its own
  Chromium session and proxy. It loads the configured LAN URL and nothing
  else as a top-level page.
- **Go core.** A userspace WireGuard device, a TCP/IP stack, a localhost HTTP
  proxy, the vault, and a small control API. It runs as an ordinary user.
- **Data directory.** Config, vault, and the Chromium profile. On Linux it
  lives beside the AppImage when that location is writable; otherwise in the
  normal per-user config directory.

Startup sequence:

1. Unlock the vault, or use the convenience key.
2. Start the core and wait for the WireGuard handshake.
3. Start the localhost proxy on a random loopback port.
4. Point the dashboard session at the proxy and load the configured URL.
5. On lock, close, or crash, stop the core and drop the tunnel.

## The tunnel

The core uses `wireguard-go` with a gVisor netstack. WireGuard normally wants
a TUN device; here the netstack provides the other end of the device in
userspace, so the app never opens `/dev/net/tun` and never asks for
privileges. TCP connections are dialed through the netstack and handed to the
proxy.

The WireGuard handshake still travels over UDP to the public endpoint, using
whatever network the machine already has. If the user's normal VPN is active,
that handshake simply rides inside it. A hostname endpoint is resolved to an
address at startup; a literal IP is used as-is. The tunnel does not re-resolve
while it is running.

`AllowedIPs` from the imported config is not trusted. The app overrides it
with private ranges only:

- `10.0.0.0/8`
- `172.16.0.0/12`
- `192.168.0.0/16`
- `fc00::/7` for IPv6 where available

A config that says `AllowedIPs = 0.0.0.0/0` will therefore still only carry
LAN traffic inside the app. The endpoint connection is separate and is not
affected by that override.

## The browser and the LAN policy

The dashboard is rendered by Chromium inside Electron. The system Chrome is
not used, and the app does not depend on a browser being installed.

Every HTTP and HTTPS request from the dashboard session goes through the
localhost proxy. The proxy resolves and classifies the destination before it
dials:

- Private IPv4 and IPv6 ranges: allowed, dialed through the WireGuard
  netstack.
- Loopback: blocked. This prevents a page from reaching the app's own control
  socket, proxy, or anything else listening on localhost.
- Public addresses: blocked by default.
- Multicast, unspecified, link-local and anything else: blocked.

Top-level navigation is separate from subresources. Even when external
content is enabled, the dashboard view cannot become a general web browser.
Public links get a small blocked page with an option to open them in the
system browser, which uses the normal connection.

The proxy supports plain HTTP, HTTPS via `CONNECT`, WebSockets and streaming
responses. TLS is passed through end to end; the app does not intercept or
rewrite encrypted traffic.

## External content

Dashboards often pull fonts, icons or widget data from public origins. Strict
LAN-only mode blocks those and the page falls back to system fonts or empty
widgets.

The internet toggle is off by default. When it is on:

- External requests are allowed only for subresources, never as the page.
- An optional "ask before contacting a new site" switch groups the origins
  from the first page load into one prompt: allow all, review each, or block
  all. Approved origins are remembered.
- An external sites panel lists what has been contacted and allows individual
  origins to be blocked later.
- HTTP requests have `Referer` and `Cookie` removed. HTTPS requests are
  protected by Chromium's third-party cookie blocking plus a no-referrer
  policy on the dashboard response; TLS itself is not intercepted.
- Allowed origins still see the request and the user's IP. The UI says so
  rather than implying otherwise.

If the dashboard fetches its widgets on the server side, the browser never
contacts those services and the toggle is irrelevant.

## Secrets, app lock and portable data

Sensitive data lives in a single vault file:

- WireGuard private key and preshared key.
- Any future saved tokens.
- Non-secret settings can stay in a plain config file.

The vault is encrypted with XChaCha20-Poly1305 under a random 256-bit key.
How that key is protected depends on the chosen mode:

- **Password mode.** Argon2id derives a key from the app password. The vault
  opens after the password is entered. No OS keyring is involved.
- **Convenience mode.** The vault key is stored in a `0600` file in the app's
  data directory. It opens straight to the dashboard and is only as strong as
  the device account.

The app lock is optional. Any password is accepted; a strength meter warns
about weak ones but does not block them. Wrong attempts get a growing delay.
The lock is a casual privacy screen, not a defense against a forensic
attacker. Locking stops the tunnel.

There is no password recovery. An encrypted export is available for backup or
moving to another device.

On Linux, portable mode keeps data beside the AppImage when that folder is
writable. Otherwise it falls back to the per-user config directory. On
Android, app storage is already sandboxed; portability is handled through the
encrypted export/import bundle.

## Privacy and security

- No telemetry, analytics, crash uploads, accounts or update pings.
- Chromium's background networking and known Google service hooks are
  disabled. The build and runtime are audited for unexpected outbound
  connections.
- Permissions (camera, microphone, geolocation, notifications, clipboard)
  are denied unless a future feature explicitly needs one.
- The dashboard view has no Node integration, no preload bridge, no file
  access and no popups. Navigation is restricted to private addresses.
- If the tunnel drops, LAN requests fail. There is no direct fallback.
- The app does not listen on the network; it is not a remote-access server.

The full threat model and the audit checklist are in
[docs/SECURITY.md](SECURITY.md).

## Platforms and stack

Linux first:

- Go core: WireGuard, netstack, proxy, vault.
- Electron with TypeScript for the shell and settings UI.
- Chromium for the dashboard, bundled with Electron.
- AppImage for distribution, with a portable data folder.

Android later uses Kotlin, Jetpack Compose and the system WebView. The same Go
core runs in-process through gomobile. Windows later reuses the Electron shell
and the Go core.

## Decisions

**Userspace WireGuard instead of a system tunnel.** A system tunnel takes the
single VPN slot on Android and needs root or route changes on Linux. Neither
fits the requirement to keep the normal VPN running.

**Electron instead of Tauri or WebKitGTK.** Chromium is what these dashboards
are tested against, and an AppImage that carries its own engine is easier to
support across distributions. Tauri would be smaller and lighter, but
WebKitGTK introduces media and compatibility risk plus a host dependency. The
Go core is UI-agnostic, so the shell can be replaced later if Electron becomes
a real problem.

**Go instead of Rust for the core.** `wireguard-go` and the gVisor netstack
already provide the userspace tunnel and TCP stack. A Rust core would mean
building and maintaining that bridge by hand.

**A self-contained vault instead of the OS keyring.** Keyrings are inconsistent
across Linux desktops and awkward from portable media. Argon2id and a portable
vault behave the same everywhere.

**Strict LAN-only by default.** The app is a LAN browser, not a second web
browser. External content is opt-in and visible.

## Risks and open questions

- Jellyfin playback in an embedded Chromium engine needs testing with real
  media and transcoding.
- Chromium has optional background service hooks. They must be disabled and
  verified, not assumed.
- The AppImage must run with the Chromium sandbox enabled; `--no-sandbox` is
  not an acceptable default.
- When the machine is already on the home network, NAT loopback may prevent
  the endpoint from being reachable. The first version always tunnels; a
  direct-on-home-LAN mode is a later question.
- LAN services with self-signed HTTPS certificates will show a certificate
  error until a trust flow exists.
- Browser cookies are not inside the vault. The app lock gates access, and a
  "clear session on exit" option is planned.
- A weak app password weakens the vault. The UI will say so.
- Windows builds will need code signing to avoid SmartScreen warnings.
