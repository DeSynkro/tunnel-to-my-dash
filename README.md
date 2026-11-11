# Tunnel to My Dash

Open your home dashboard from anywhere without switching off your VPN.

Tunnel to My Dash is a desktop app that runs a WireGuard tunnel inside the
application and uses that tunnel for one thing: browsing your local network.
It does not create a system VPN, ask for root, or change your routing table.
Your normal VPN keeps running.

Status: early development. The tunnel, LAN-only proxy and encrypted vault
core are working. The desktop shell is being built.

## Why

If your dashboard, Jellyfin, or a dev container lives on your home LAN, the
usual routine is to disconnect the VPN, bring up WireGuard, do the thing, and
switch back. It is tedious and easy to get wrong.

This app makes the tunnel part of the app. Open it, and it connects to your
home endpoint and loads the dashboard. Close it and the tunnel is gone. Only
the app's own traffic uses the tunnel.

## How it works

- A small Go core runs a userspace WireGuard device and a TCP/IP stack, so no
  root or system VPN slot is needed.
- A localhost HTTP proxy feeds the app's browser view through that tunnel.
- The browser view is Chromium (via Electron). By default it can only reach
  private addresses; public pages are blocked.
- An optional internet toggle lets the dashboard load external fonts and
  widgets. External requests can be reviewed and blocked per origin.
- Secrets live in an encrypted vault. The app lock is optional; the same
  password unlocks the vault.

More detail in [docs/DESIGN.md](docs/DESIGN.md).

## Principles

- No telemetry, analytics, accounts or cloud.
- No system VPN, root or firewall changes.
- Strict LAN-only by default; fail closed.
- WireGuard keys never stored in plaintext.
- Linux first; Android and Windows later.

## Layout

    core/       Go tunnel, proxy, vault and CLI
    desktop/    Electron shell and UI
    docs/       design, roadmap, plan and security notes
    scripts/    build and toolchain helpers

## Development

Requirements: Linux, Node.js 24+ and Go. The Go toolchain is downloaded into
`.tools/` (gitignored) so the build does not depend on a system install.
Electron and npm dependencies stay in `desktop/node_modules` and `.cache/`.

Build caches and temporary files stay inside the project:

    make help
    make env
    make desktop-deps
    make desktop-check
    make desktop-start
    make clean

Never commit a real WireGuard config or vault. Put local test files in
`local/`, which is ignored.

## License

GPL-3.0. See [LICENSE](LICENSE).
