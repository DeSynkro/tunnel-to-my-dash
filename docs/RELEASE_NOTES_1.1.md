# Tunnel to My Dash 1.1.0

1.1.0 is a security-hardening release. It keeps the app-local userspace
WireGuard tunnel, local proxy and encrypted vault, and closes the browser and
release-integrity gaps found in the 1.0 review.

## Security changes

- **Browser boundary:** dashboard traffic can no longer reach loopback or
  link-local services by bypassing the proxy. Desktop uses an in-memory
  partition with Chromium's implicit bypass disabled; Android removes the
  WebView implicit rules and adds a local-destination guard.
- **Navigation:** redirects and meta refresh are checked with the same policy
  as normal navigation. A private dashboard cannot be redirected to a public or
  loopback page.
- **Browser state:** dashboard cookies, site storage, cache and HTTP auth state
  are cleared on lock, close and quit. Older desktop `persist:profile-*`
  partitions are removed at startup.
- **External content:** public external content now requires HTTPS by default.
  LAN HTTP dashboards keep working. A global setting in desktop and Android
  allows plain HTTP external content for legacy widgets.
- **Vault KDF bounds:** malicious vaults or exports cannot request excessive
  Argon2id time, memory or thread counts.
- **Local proxy authentication:** desktop dashboard sessions use a per-run
  proxy token and fail closed without it. Android keeps the loopback-only
  fallback until WebView proxy authentication is device-verified.
- **IPC:** privileged desktop IPC only accepts known top-level windows and
  toolbar webContents, not dashboard pages or subframes.

## Release integrity

- Android release builds now use a dedicated RSA 4096 key. The certificate is
  `CN=Tunnel to My Dash Release, OU=Android, O=DeSynkro, C=US`, SHA-256
  `43:D3:45:D8:97:73:4C:1C:1A:3B:0D:C7:7C:06:AE:4C:66:FF:B2:7B:B8:91:44:F1:C6:97:30:F6:5F:00:C0:13`.
- Tags and manual release runs build the signed APK in CI, verify the
  certificate and debuggable flag, and publish a versioned APK plus checksum.
  The APK is `versionName` 1.1.0, `versionCode` 2, with v3 APK signing.
- Actions are pinned to commit SHAs, desktop installs use `npm ci`, Gradle and
  Android command-line downloads are checksum-pinned, and packaged Electron
  builds load only from `app.asar` with Node execution/inspection fuses off.
- Windows packaged builds also enable embedded ASAR integrity validation.

## Upgrade notes

- **Android 1.0:** 1.0 was signed with a debug-profile key. Export the vault,
  uninstall 1.0, install 1.1.0 and import the vault. Android cannot update
  across signing identities.
- **Desktop:** normal in-place upgrade.
- Dashboard logins may be required again after locking or quitting because
  browser state is cleared. Saved desktop app passwords remain in the vault.
- If a dashboard or external widget needs plain HTTP, turn off **Require HTTPS
  for external content** in Settings. LAN HTTP does not need this.

## Known limitations

- Android DNS/WebView leakage has not been packet-tested. Desktop disables
  Chromium's resolver; Android relies on the installed WebView's proxy/DNS
  stack, so this release does not claim zero DNS leakage on Android.
- Android WebView proxy authentication is prepared but disabled in 1.1.
- The vault is app-managed and not bound to an OS keyring. Optional
  device-bound storage is designed for a later release and must preserve
  export/recovery before it ships.
- No independent security audit has been performed.

Source and license: GPL-3.0. Verify the published SHA-256 and Android
certificate fingerprint before installing.
