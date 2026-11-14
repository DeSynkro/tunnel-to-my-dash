<p align="center">
  <img src="logo/banner.svg" alt="Tunnel to My Dash — a cream house with a tunnel arch" width="960">
</p>

<p align="center">
  <strong>A private route to your home dashboard, without switching off your VPN.</strong><br>
  Linux, Windows and Android, sharing one small Go core.
</p>

<p align="center">
  <a href="https://github.com/DeSynkro/tunnel-to-my-dash/actions/workflows/ci.yml"><img src="https://github.com/DeSynkro/tunnel-to-my-dash/actions/workflows/ci.yml/badge.svg" alt="Build status"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-GPLv3-blue.svg" alt="License: GPL v3"></a>
  <a href="https://github.com/DeSynkro/tunnel-to-my-dash/releases"><img src="https://img.shields.io/badge/version-1.0-orange.svg" alt="Version 1.0"></a>
  <img src="https://img.shields.io/badge/platform-Linux%20%7C%20Windows%20%7C%20Android-lightgrey.svg" alt="Linux, Windows and Android">
</p>

<p align="center">
  Built by <a href="https://desynkro.com">DeSynkro</a> with assistance from <a href="https://opencode.ai">OpenCode</a>.
</p>
<p align="center">
<a href="https://ko-fi.com/desynkro"><img src="https://img.shields.io/badge/Ko--fi-support%20me-ff5e5b?logo=kofi&amp;logoColor=white" alt="Support me on Ko-fi"></a>
</p>

<p align="center">Tunnel to My Dash opens a dashboard on your home network through a WireGuard tunnel owned by the app. It does not take the system VPN slot, ask for root, or route the rest of your phone or computer through your house. Your normal VPN keeps working.</p>

## Why this exists

I made this app because I found myself constantly switching VPNs for my workflow, It got to the point that I would lose track of which VPN tunnel I was using and ended up using a work tunnel for personal things or just completely forgot to switch out of my personal LAN after I was done doing what I needed.

Most home dashboards assume you are already on the LAN. Away from home, the usual routine is to connect or switch to your Network VPN/WireGuard, open the dashboard, do what you need and then switch everything back.

It is tedious and easy to forget which state you are in, Especially when you're doing it multiple times in a day.

This app makes the tunnel part of the app instead. Open the dashboard you want, and the app starts its own tunnel and local proxy. 

Stop the connection and the tunnel is gone. Only the app's browser uses it.

## Requirements

- A WireGuard config for your home endpoint.
- A dashboard or other self-hosted service reachable on your LAN.
- **Linux:** a recent glibc distribution and FUSE for the AppImage.
- **Windows:** Windows 10 or newer for the portable `.exe`.
- **Android:** Android 10 or newer. The APK is installed directly; no Play Store
  account or Google Play services are required.
- Your normal VPN can stay connected. The app does not create a system VPN or
  change system routing.

## Quick start

Download the latest release from the
[releases page](https://github.com/DeSynkro/tunnel-to-my-dash/releases).

### Linux AppImage

```bash
chmod +x Tunnel-to-My-Dash-*.AppImage
./Tunnel-to-My-Dash-*.AppImage
```

The app keeps its vault, Chromium profile and core socket in
`tunnel-to-my-dash-data/` beside the AppImage. Move the AppImage and that folder
together. If the folder is not writable, it falls back to the normal per-user
data directory.

### Windows portable

Run `Tunnel-to-My-Dash-<version>-portable-x64.exe`. The app keeps its data
beside the executable, so the folder is portable and can be moved as one piece.

### Android

Install the APK, create a vault, then add a dashboard. The Add dashboard screen
accepts a WireGuard `.conf` file or a QR code. The camera is used only while
scanning, and the QR text goes into the encrypted vault like a file import.

A foreground notification keeps the tunnel alive when you switch apps or turn
the screen off. Stop it from the notification or the app's menu.

## Build from source

Requirements: Linux, Node.js 24+, Go, and for Android the project-local Android
toolchain. The Go, JDK, Android SDK/NDK, Gradle and gomobile caches stay inside
the checkout.

```bash
make core
make desktop-deps
make desktop-check
make desktop-start
```

Build the distributables:

```bash
make appimage        # Linux AppImage + SHA256SUMS
make android-setup   # install the project-local Android toolchain once
make android-release # signed Android APK
```

CI builds and uploads the Linux AppImage and Windows portable artifacts. The
Android APK is built locally because its signing key is not committed.

## Features

- **App-owned tunnel:** userspace WireGuard and a local proxy, with no root,
  `/dev/net/tun` or system VPN slot.
- **One core, three shells:** the same Go tunnel, proxy and vault on Linux,
  Windows and Android.
- **LAN-only by default:** public content is opt-in per dashboard, either all
  public origins or an exact-origin list.
- **Per-dashboard control:** choose the active dashboard, its WireGuard config,
  dashboard URL and external-content policy.
- **Encrypted vault:** WireGuard configs, settings and desktop saved logins live
  in an app-managed vault. Password mode uses Argon2id and
  XChaCha20-Poly1305; a keyfile fallback is available.
- **Android QR import:** scan a WireGuard QR code instead of transferring a
  `.conf` file. Camera access is requested only for the scan.
- **Foreground service on Android:** the tunnel survives app switches and
  screen-off; lock-on-background, auto-connect and encrypted export/import are
  built in.
- **Public-link routing:** keep private links in the dashboard. Public links are
  blocked by default and can be opened outside the dashboard when enabled.
- **No telemetry:** no analytics, accounts, cloud sync or phone-home update
  checks.

## How it works

A small Go core runs `wireguard-go` with a gVisor netstack and a localhost HTTP
proxy. WireGuard normally needs a TUN device; the netstack provides the other
end in userspace, so the app never opens `/dev/net/tun` or asks for privileges.

On Linux and Windows, Electron hosts the dashboard in a dedicated Chromium
session pointed at the local proxy. On Android, the dashboard lives in the
system WebView inside a native `FrameLayout`; a foreground service owns the
tunnel. The app sends only its browser traffic through the tunnel. Your other
apps and your normal VPN are unaffected.

More detail: [docs/DESIGN.md](docs/DESIGN.md) and
[docs/ANDROID.md](docs/ANDROID.md).

## Security and limitations

- **This is not a system VPN.** Only the app's browser uses the tunnel. There is
  no system-wide kill switch, and other apps are not protected.
- **The Android local proxy is unauthenticated while the tunnel is running.** It
  binds to `127.0.0.1` on a random port and closes on Stop, but another app on
  the phone could use it if it discovered the port. It cannot read the vault or
  other apps' cookies.
- **HTTP dashboards stay plaintext.** WireGuard protects the path to your home
  endpoint; it does not encrypt the final LAN hop. Use HTTPS for sensitive
  dashboards.
- **Vault strength depends on your password.** A keyfile vault is unlocked by
  the app's private key file; use a password and lock-on-background on a
  portable or shared phone.
- **QR codes are sensitive.** A WireGuard QR contains a private key and endpoint.
  Only scan configs you trust.
- **Keep the app and system WebView updated.** The Android client uses the
  system WebView, and the APK is distributed outside the Play Store.
- **1.0 is signed with a local project key**, not a production app-store
  identity. Verify the published SHA-256. A future signing-key change requires
  an uninstall/reinstall.
- **No independent security audit.** The scope is deliberately small and the
  source is open, but treat it as a practical tool rather than a high-assurance
  VPN.

Tested on a Samsung Galaxy S21 (Android 15, WebView 131) and a Google Pixel 10
Pro running GrapheneOS. Other devices may vary.

## What data is stored

| Kept locally | Not collected |
|---|---|
| WireGuard configs and keys in the encrypted vault | No analytics or telemetry |
| Dashboard URLs, names and settings | No accounts or cloud sync |
| Desktop saved dashboard logins in the vault | No crash uploads |
| Android Basic-auth credentials in memory only | No camera frames or QR images |
| Local Electron/Android app data | No update checks or phone-home |

The app has no telemetry, accounts or update checks. Its intended network
traffic is your WireGuard endpoint and the dashboards you open. Public links
leave the app only when you enable that setting; they open in the system
browser.

## Tech stack

| Part | Technology |
|---|---|
| Core | Go, `wireguard-go`, gVisor netstack |
| Proxy | Localhost HTTP/HTTPS proxy with LAN and external-origin policy |
| Vault | XChaCha20-Poly1305, Argon2id, app-private storage |
| Desktop | Electron, TypeScript, HTML/CSS |
| Android | Kotlin, Jetpack Compose, system WebView, gomobile |
| Packaging | AppImage, portable `.exe`, signed APK |
| CI | GitHub Actions: Linux, Windows and Android |

## Current limits

- Android exposes the "allow external content" switch but does not edit an
  exact-origin allowlist; that remains a desktop feature.
- Fingerprint unlock is optional and off by default; the vault password is
  always the fallback.
- The Android CI job builds and uploads a debug APK; the signed release APK is
  produced locally with the project signing key.

## Development

The test and build commands use the project-local toolchains:

```bash
make help
make env
make check
make desktop-deps
make desktop-check
make android-test
make android-release
make appimage
make clean
```

Never commit a real WireGuard config or vault. Put local test files in
`local/`, which is ignored. Deferred work and ideas live in
[docs/BACKLOG.md](docs/BACKLOG.md).

## Support

If my work helped you in any way, please consider supporting me on [Ko-fi](https://ko-fi.com/desynkro). More of my work is at [desynkro.com](https://desynkro.com).

## License

GPL-3.0. See [LICENSE](LICENSE).

## Credits

- Built by [DeSynkro](https://desynkro.com)
- Assisted by [OpenCode](https://opencode.ai)
- Thank you to everyone who tested, listened and helped 😄️

<p align="center">
  <a href="https://desynkro.com" target="_blank">
    <img src="logo/desynkro.png" width="240"
         alt="DeSynkro"
         style="background:#0d1117;border-radius:8px;padding:8px 14px">
  </a>
</p>
