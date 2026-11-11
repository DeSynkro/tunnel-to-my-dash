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
- **Dashboard view.** A separate `BaseWindow` with a sandboxed
  `WebContentsView` and its own Chromium session and proxy. It loads the
  configured LAN URL and nothing else as a top-level page. A 36px navigation
  bar is a centered floating glass bar. With auto-hide on it shrinks to a
  small centered peek pill and overlays the dashboard; hovering expands it with
  a short animated resize. With auto-hide off the bar becomes a plain
  full-width row above the view, so it covers nothing and has no floating pill
  frame. The window X quits the app; the Main menu button returns to the main
  menu. A padlock shows an opaque lock overlay over a blurred
  snapshot of the page, hides the live page, disconnects the tunnel and
  reconnects the same dashboard after unlock. Back to main menu from that
  overlay suppresses auto-open once so the next unlock lands on the main menu.
  Embedding the dashboard in the main shell is a later refinement.
- **Go core.** A userspace WireGuard device, a TCP/IP stack, a localhost HTTP
  proxy, the vault, and a small control API on a `0600` Unix socket. It runs
  as an ordinary user.
- **Data directory.** `settings.json` for behavior, `core/` for the vault and
  security policy, and `electron/` for the Chromium profile. On Linux it lives
  beside the AppImage when that location is writable; otherwise in the normal
  per-user config directory.

Startup sequence:

1. Unlock the vault, or use the convenience key.
2. Start the core, the WireGuard device and the localhost proxy.
3. Point the dashboard session at the proxy and load the configured URL.
   The first request triggers the WireGuard handshake.
4. If Open last dashboard after launch is on, open the last active dashboard
   after the first unlock and after every later unlock.
5. On dashboard close, lock, or crash, stop the core and drop the tunnel.

### Interface

The shell uses one neutral graphite ramp, an amber accent for links and focus,
vibrant green or red status dots, and cream primary actions. Addresses, versions and route labels use the
system mono. On the main, profile and settings screens a 200px rail carries
the Dashboards and Settings entries, the app-lock state and the version.
Setup is an asymmetric split; lock is a compact card. Settings uses cards:
Behavior and Security on top and App lock full width, with the storage note
below. The active profile is probed once at startup; the profile status dot is
also a button for a manual re-check. It dials the dashboard host and port
through the tunnel and turns green or red, with no label. The house mark and
route line are the repeating signature detail. Short labels are sentence case,
and spacing stays on a 4px scale.

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
- Public addresses: blocked unless the profile opts into an exact external
  origin.
- Multicast, unspecified, link-local and anything else: blocked.

Top-level navigation is separate from subresources. Even when external
content is enabled, the dashboard view cannot become a general web browser;
every top-level URL must be a private address. Public links stay blocked.

The proxy supports plain HTTP, HTTPS via `CONNECT`, WebSockets and streaming
responses. TLS is passed through end to end; the app does not intercept or
rewrite encrypted traffic.

Chromium's own DNS resolver is disabled. The shell only loads local files and
the dashboard URL is an IP literal; every name that needs resolving is resolved
by the proxy. A background service that tries to look something up fails closed
instead of reaching the internet.

## External content

Dashboards often pull fonts, icons or widget data from public origins. Strict
LAN-only mode blocks those and the page falls back to system fonts or empty
widgets.

External content is set per profile in the profile editor, off by default.
There are three modes:

- **LAN only.** Every public origin is blocked.
- **Allow all external content.** Any public origin may load. This is for
  dashboards whose widget set is not practical to enumerate.
- **Allow specific content.** The user lists exact origins. Paths, credentials
  and wildcards are rejected, so a rule cannot silently widen.

In both external modes the traffic goes over the normal network or VPN, never
through the WireGuard tunnel. The proxy resolves external names itself and
dials only public addresses; a name that resolves to loopback, a private range
or CGNAT is refused. Top-level navigation stays private-only, and external
origins are for subresources such as fonts, icons and widgets. Allowed origins
still see the request and the user's IP.

The app-wide **Force LAN-only for all profiles** setting overrides every
profile's mode. It is stored in the vault, unchecked by default, and leaves the
profile choices intact. While it is on, the profile editor greys out the
external section and the profile cards report `LAN only (app override)`.

## Settings storage

Behavior settings live in plaintext `settings.json` beside the portable data so
they are easy to inspect and copy. Security policy lives in the encrypted
vault so it is tamper-evident and travels with the secrets:

- `settings.json`: open the last dashboard after launch and auto-hide the
  dashboard toolbar.
- Vault: Force LAN-only, lock after idle and the idle minutes value.

The app lock remains a vault mode. Idle lock is only offered when an app
password is set; keyfile vaults have no lock screen. The idle timer pauses
while the dashboard is audible, so media playback is not interrupted.

If the dashboard fetches its widgets on the server side, the browser never
contacts those services and the switch is irrelevant.

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

## Profiles

A profile bundles one tunnel config, one dashboard URL, a display name and the
external-content settings for that dashboard. The vault stores a list of
profiles and remembers the last active one. Only one tunnel runs at a time:
switching stops the current tunnel, starts the selected one and loads its
dashboard.

The first release can ship with a single profile and no picker. The vault and
core APIs use stable profile IDs from the start, so adding a switcher later is
a UI change rather than a data migration. Each profile gets its own Chromium
session partition, so cookies from two dashboards that happen to share the same
LAN IP do not collide.

## Saved passwords

Each profile can keep a list of service logins: a name, an optional URL, an
optional username and a password. They live inside the encrypted vault, so an
export carries them and deleting a profile deletes its logins.

Editing happens in the profile editor on its own screen. Copying happens in
the dashboard toolbar: a key button opens a small panel under the bar, and
each login has Username and Password copy buttons. The renderer only ever
receives names, URLs and usernames. When a copy button is pressed, the main
process fetches that one password from the core over the control socket and
writes it straight to the clipboard, so the secret never reaches a renderer.
The clipboard clears itself after 30 seconds if it still holds the copied
value, and clears at once when the dashboard locks. There is no autofill and
no reveal control.

The toolbar panel pins the floating bar open while it is visible and closes
on an outside click, Escape, navigation, window blur or lock. Editing a saved
login leaves the stored password untouched unless a new one is typed.

While a dashboard page is open, a minimal isolated preload watches login
submissions: a form submit, Enter in a password field or a click on a login
button. It reads the username, password, page title and origin, and sends
them to the main process. The main process ignores subframes, non-private
origins, locked vaults and malformed payloads, then offers a native Save
password dialog showing the service name and URL — never the password.
Saving uses the active profile, sets the URL to the page origin and names the
login from the page title, falling back to the host. Exact matches are
ignored, an existing origin and username with a new password prompts to
update, and Not now is remembered for the session. There is still no
autofill.

## Privacy and security

- No telemetry, analytics, crash uploads, accounts or update pings.
- Chromium's background networking and known Google service hooks are
  disabled. The build and runtime are audited for unexpected outbound
  connections.
- Permissions (camera, microphone, geolocation, notifications, clipboard)
  are denied unless a future feature explicitly needs one.
- The dashboard view has no Node integration, no file access and no popups.
  A minimal isolated preload watches login submissions and reports a
  candidate to the main process; it exposes no API to the page. Navigation is
  restricted to private addresses.
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

## Brand and interface palette

The identity is the house-and-tunnel mark: a cream house on a dark teal tile,
with an amber tunnel glow. The logo set in `logo/` is the source of truth;
derived PNGs are committed so a build does not depend on an SVG rasteriser.

- The masthead and lock screen use `icon-small.svg` as their mark (28px and
  22px). The HTML wordmark and tagline stay; the README uses the full banner
  composition.
- A 512px PNG rendered from `icon.svg` replaces `desktop/build/icon.png`. It
  is the window icon and the AppImage `.desktop` icon.
- `logo/banner.svg` sits at the top of the README.
- The main window, dashboard toolbar and lock overlay share one palette.

Palette choice B: the base is a neutral graphite ramp with no colour cast,
text is warm off-white, and the logo's amber is the accent. Amber is a
highlight only (focus rings, links, route dots), never a large fill. Primary
buttons use the logo cream. Status dots are the only saturated colour:
vibrant green `#3ddc84` for reachable, connected and app-lock-on, vibrant red
`#ff5c5c` for unreachable, and neutral grey for unknown or key-file mode.
Danger stays salmon. Layout, spacing and type are unchanged.

| Token | Before | After |
| --- | --- | --- |
| background | `#0b0d12` | `#0e0e0e` |
| surface | `#11141b` | `#141414` |
| raised surface | `#171b23` | `#1a1a1a` |
| text | `#e9ebef` | `#ece7dd` |
| secondary | `#a2a8b3` | `#a9a49a` |
| accent | `#7fd1b9` | `#f0a35a` |
| primary button | `#e9ebef` | `#efe7d6` |
| status ok | `#7fd1b9` | `#3ddc84` |
| status bad | `#d18c86` | `#ff5c5c` |

Non-goals: no light theme, no typography change, no tray or launch-at-login
work, and no Android icon work yet. `icon-light.svg` and `icon-ios.svg` stay
unused for now.

Verification: body and secondary text keep AA contrast on their surfaces;
faint metadata stays decorative and is no dimmer than before. The mark stays
legible at 22-28px, screenshots cover the main menu, settings, both toolbar
modes and the lock overlay, and the packaged AppImage passes the full,
settings, toolbar, fixed, refocus, lock and lock-back flows.

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
