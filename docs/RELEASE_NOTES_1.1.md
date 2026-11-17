# Tunnel to My Dash 1.1

**A security-hardening release for the app-owned route to your home dashboard.**

1.1.0 keeps the same app-local WireGuard tunnel, localhost proxy and encrypted
vault. It closes the browser-boundary and release-integrity gaps found in 1.0,
and makes the remaining limitations explicit. Existing vaults keep working; the
vault format did not change.

## Highlights

- **Hardened browser boundary** — dashboard traffic can no longer bypass the
  proxy to reach loopback or link-local services on desktop or Android.
- **Redirects covered** — a private desktop dashboard can no longer escape its
  navigation policy through an HTTP redirect or meta refresh.
- **Cleaner browser state** — dashboard cookies, site storage, cache and HTTP
  auth state are cleared on lock, close and quit. Desktop uses in-memory
  sessions and removes legacy persisted partitions; Android clears WebView
  state on lock and cold start.
- **HTTPS for external content by default** — public external content must use
  HTTPS. LAN HTTP dashboards still work, and a settings opt-out covers legacy
  HTTP widgets.
- **Stronger vault and IPC** — Argon2id parameters are bounded; desktop uses a
  per-run proxy token; privileged desktop IPC only accepts known top-level
  windows.
- **Dedicated Android signing** — 1.1 is signed with a new RSA 4096 release key
  and v3 APK signing. CI verifies the certificate and rejects debug-signed or
  debuggable APKs.
- **Hardened builds** — GitHub Actions are pinned, desktop installs use
  `npm ci`, Gradle and Android downloads are checksum-verified, and packaged
  Electron builds use restricted fuses and `app.asar`.

## Downloads

| Platform | Artifact | Notes |
| --- | --- | --- |
| Linux | AppImage | FUSE is required, or run with `--appimage-extract-and-run`. Data stays beside the AppImage. |
| Windows | Portable `.exe` | No installer. Data stays beside the executable. |
| Android | APK | Android 10 or newer. No Play Store account or Google Play services required. |

Verify the published SHA-256 checksums. The Android release certificate
SHA-256 is
`43:D3:45:D8:97:73:4C:1C:1A:3B:0D:C7:7C:06:AE:4C:66:FF:B2:7B:B8:91:44:F1:C6:97:30:F6:5F:00:C0:13`.

## Upgrading from 1.0

**Android 1.0 users cannot update in place.** The signing key changed. Export
the vault, uninstall 1.0, install 1.1.0 and import the vault.

Desktop upgrades in place. Dashboard logins may be required again after locking
or quitting because browser state is cleared; saved app passwords remain in the
vault. If an external widget needs plain HTTP, turn off **Require HTTPS for
external content** in Settings.

## Known limitations

- The Android loopback/link-local guard is built and unit-covered but still
  needs a physical-device pass.
- Android WebView DNS leakage has not been packet-tested, and WebView proxy
  authentication is prepared but disabled until device verification.
- The vault is app-managed and not bound to an OS keyring in 1.1. Optional
  device-bound storage is planned for 1.2.
- No independent security audit has been performed.
