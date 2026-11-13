# Android client — Tunnel to My Dash 1.0

## Intent

Build the real Android client for Tunnel to My Dash. It connects to a LAN
dashboard through the app's own userspace WireGuard tunnel and local HTTP
proxy. It must not use Android's VPNService or occupy the system VPN slot, so
ProtonVPN and other VPN apps remain usable. The client stores profiles and
WireGuard configurations in an encrypted, app-managed vault, is LAN-only by
default, and never sends telemetry.

The Android client runs the Go core through `gomobile`, and the WebView uses a
per-app proxy override. The dashboard, Glances, OpenCode, Pi-hole, the portfolio
lightbox, Jellyfin playback and fullscreen work on the Pixel test profile.

## Goals

- First-run vault creation in app-private storage, with an optional password and
  a keyfile fallback. The vault is app-managed; no OS keyring is required to
  decrypt it.
- Multiple profiles: name, WireGuard `.conf`, dashboard URL, external-content
  policy, and one active profile.
- Optional fingerprint unlock, off by default, using BiometricPrompt with the
  password as the fallback and Android Keystore guarding only a local token.
- Connect/disconnect with a foreground service that keeps the tunnel alive while
  the app is backgrounded or the screen is off. Low-priority notification with
  a Stop action.
- Native WebView dashboard screen with a compact toolbar, HTML fullscreen,
  HTTP Basic auth dialog, system autofill for logins, and a local error/retry
  state.
- Reuse the Go vault, profile, external-origin, tunnel and proxy code. Extend
  `core/mobile` only where the native client needs it.
- Global settings for opening public links in the system browser, locking when
  the app is backgrounded or the screen turns off, and auto-connecting on
  launch.
- Encrypted vault export/import through the system file picker, so profiles and
  keys can be backed up or moved between devices.
- A signed, non-debuggable 1.0 APK. No Play Store requirement.

## Non-goals for 1.0

- In-app saved-password capture or fill. Android system autofill (Bitwarden,
  etc.) handles logins. Basic-auth credentials are held in memory only.
- Link routing beyond the single desktop-style public-link switch: no separate
  browser windows, downloads manager, tabs or history. LAN/private links stay in
  the WebView; public top-level links are blocked or handed to the system
  browser according to the switch.
- Android VPNService, always-on VPN, or system proxy configuration.
- No OS keyring as the vault's encryption key. Biometric unlock uses Android
  Keystore only for a local convenience token; the vault stays app-managed and
  password-encrypted, with the password as the fallback.
- Play Store distribution, managed configurations, analytics or telemetry.
- Bundling GeckoView or another browser engine. The system WebView is the
  engine; the host is a native Android view.
- Desktop-only features such as saved logins and window management.

## Constraints and verified facts

- Kotlin/Compose shell, `minSdk 29`, existing package
  `com.desynkro.tunneltomydash`.
- The Go core is linked with `gomobile`; the core must remain usable from the
  desktop/CLI builds.
- The live WebView must be a native child of a `FrameLayout`, never inside a
  Compose `AndroidView`. A Compose `AndroidView` host gives the top-level
  WebView a zero-height layout viewport: `innerHeight` was 918 while `100vh`
  and `min-height` media queries resolved to 0. A plain `FrameLayout` WebView
  reports 918.095 px and all sites render correctly.
- Only `INTERNET`, notification/foreground-service permissions and
  `USE_BIOMETRIC` are needed. No storage, contacts, location, camera or
  microphone permissions.
- App-private data only. The vault and keyfile live under the app's private
  files directory; `allowBackup` stays false.
- Project-local Android, JDK, Gradle and gomobile caches.
- Primary test device: Pixel 10 Pro on GrapheneOS, in a disposable test
  profile. The S21 is not a target; its WebView is old.

## Architecture

### Components

- **MainActivity** hosts a native `FrameLayout` root. It contains:
  - a `ComposeView` for setup, unlock, profile list/editor and settings;
  - the live WebView as a native sibling, shown only while connected;
  - a native or Compose toolbar/error overlay that is also a sibling, never a
    parent of the WebView.
- **TunnelService** is a foreground service that owns the Go core connection.
  It starts the tunnel/proxy from the active profile, exposes the proxy address
  and connection state to the activity, shows the notification, and stops the
  core on Stop or service destruction. It does not touch the WebView.
- **Mobile bridge** (`core/mobile`) is the gomobile API for the vault, profiles,
  connection and settings. It keeps secrets in Go memory and returns only what
  the native UI needs.
- **WebView screen** is a native `WebView` with `ProxyController` set to the
  service's proxy address. It owns the toolbar actions, fullscreen custom view,
  Basic-auth dialog, error/retry overlay and page lifecycle.

### Connection flow

1. The user unlocks the vault if it is password-protected and selects a profile.
2. Tapping Connect starts `TunnelService` with the active profile ID. The
   service marks itself foreground and starts the Go tunnel/proxy with the
   profile's tunnel config and external mode.
3. The service returns the proxy address (for example `127.0.0.1:38447`).
4. The activity sets the WebView proxy override, creates a fresh WebView,
   attaches it to the root `FrameLayout`, and loads the dashboard URL only
   after the view is attached and sized.
5. The service keeps running if the activity is backgrounded or the screen is
   off. The WebView may be paused by Android; on return the activity reloads if
   needed.
6. Stop (toolbar, notification action, or task removal) stops the core, clears
   the proxy and removes the notification. The activity returns to the profile
   screen.

### Vault and lock

- On first run, create the vault in `filesDir/vault` (name decided by the
  implementation). The user may set a password or choose the keyfile fallback.
- A password-protected vault shows Unlock on cold start and after lock. A
  keyfile vault auto-unlocks and has no lock screen; Lock and lock-on-background
  controls are hidden for keyfile vaults. Set a password to enable locking.
- Lock on background: a switch (default on for password-protected vaults) that
  locks when the app is backgrounded, the user switches apps, or the screen
  turns off. Locking hides/destroys the WebView and clears in-memory Basic-auth
  credentials. The foreground service keeps the tunnel until Stop; the
  notification remains visible. On unlock, a new WebView loads the dashboard.
- If the switch is off, the UI stays unlocked while the app is backgrounded. The
  foreground service still keeps the tunnel until Stop.
- Optional biometric unlock (included, off by default): if enabled,
  BiometricPrompt can unlock a password-protected vault after setup. The vault
  remains app-managed and password-encrypted; Android Keystore may guard a local
  biometric token, with the password as the fallback. No biometric-only vault.
- Global security settings: `ForceLANOnly`, `LockOnBackground`, `AutoConnect`
  and `OpenPublicLinksInBrowser`. The shared vault's `LockAfterIdle` and
  `IdleMinutes` remain for desktop compatibility but are not used by Android.
- Secrets (WireGuard private keys, vault password, Basic-auth credentials) never
  reach the WebView or JavaScript. They may appear in the native profile editor;
  that is native UI, not a renderer.

### Profiles and external content

- Profile fields: name, WireGuard config, dashboard URL, external mode, external
  origins, active flag. Reuse `vault.Profile` validation.
- First-run and profile editor import a `.conf` through the system file picker,
  validate it through the Go core, and save it into the vault.
- Default external mode is `off` (LAN only). The profile editor offers an
  "Allow external content" switch. A profile with an exact-origin list keeps
  that list: on Android the switch can turn external content off or back on in
  origins mode, but cannot widen it to `all`. The global `ForceLANOnly` setting
  overrides per-profile external access.
- Public top-level navigation: the dashboard origin and LAN/private hosts stay
  in the WebView. Public `http(s)` top-level links are blocked by default. A
  global "Open public links in the system browser" switch mirrors the desktop
  link setting: when on, a public top-level link (including `target="_blank"`)
  opens in the system browser; when off, it is blocked with a native message.
  External mode applies to subresources, not to unrestricted top-level
  browsing.
- The profile list shows the active profile and allows Connect, Edit, Delete and
  Set active. Deleting a profile cascades its credentials in the vault.
- No profile data is written outside the vault.

### Mobile bridge API (shape, not final signatures)

The bridge may use JSON strings for complex values to avoid gomobile type
limits. It must keep the vault and active connection process-wide and be safe to
call from the activity and service.

- Vault lifecycle: `VaultExists`, `CreateVault(password)`, `OpenVault`,
  `Unlock(password)`, `Lock`, `PasswordProtected`, `ChangePassword`.
- Profiles: list/get/add/update/delete/set-active. Profile JSON includes the
  tunnel config for the native editor.
- Settings: get/set `SecuritySettings` (including `ForceLANOnly`,
  `LockOnBackground`, `AutoConnect` and `OpenPublicLinksInBrowser`).
- Connection: `StartProfile(profileID)` returns the proxy address;
  `Stop`; connection state/error reporting.
- Export/import: encrypted vault export/import using the existing vault format.
  The native UI uses SAF and prompts for the export password; no plaintext is
  written outside the vault. Export/import may be exposed as bytes or via a
  temporary file, as the plan decides.
- Version/diagnostics: core version; no secrets in return values or logs.

The exact method names and JSON shape are for the plan.

### WebView screen and chrome

- Native `WebView` in a `FrameLayout`; standard settings (`javaScriptEnabled`,
  `domStorageEnabled`, `useWideViewPort`, `loadWithOverviewMode`, media playback
  without a gesture, file/content access disabled).
- Toolbar: Back, Reload/Home, profile name, overflow with Lock and Stop.
  Fullscreen hides the toolbar; exiting restores it.
- HTTP Basic auth uses a native username/password dialog with an in-memory cache
  keyed by host and port. Cancel cancels the request.
- Navigation guard: the dashboard origin and LAN/private hosts stay in the
  WebView. Public top-level links follow `OpenPublicLinksInBrowser`: system
  browser when on, blocked with a native message when off.
- Error/retry: local error card with Try again and Profile list. A 20-second
  watchdog covers initial load and navigation; a proxy 5xx response shows the
  error immediately. Retry starts a new connection if the service is gone.
- Keep the global backdrop-filter suppression only if the native host still
  needs it; test the dashboard without it and remove it if possible. No
  site-specific CSS or JS hacks.
- System autofill is expected to work in the WebView; no custom password store.
  Test Bitwarden/system autofill on the Pixel.

### Lifecycle and foreground service

- Foreground service type: `specialUse` (Android 14+), declared with a
  `PROPERTY_SPECIAL_USE_FGS_SUBTYPE` explanation; permissions
  `FOREGROUND_SERVICE` and `FOREGROUND_SERVICE_SPECIAL_USE`. Sideloaded app, so
  no Play Store policy review.
- Auto-connect: a settings switch, default off. When on, after unlock and with
  an active profile, start the service and connect; otherwise show the profile
  screen.
- Lock on background: when enabled, lock the UI and hide/destroy the WebView
  when the app is backgrounded, the user switches apps, or the screen turns off.
  The service keeps the tunnel until Stop; the notification remains.
- Notification channel importance low, no sound/vibration. Text:
  "Tunnel to My Dash — connected to <profile>" with a Stop action. No secrets.
- Request `POST_NOTIFICATIONS` on the first connect. If denied, explain that the
  service can still run but the notification may not appear; allow connection.
- Service is not sticky. If the process is killed, the tunnel stops; on return
  the profile list offers Reconnect to the last profile and starts it again.
- The service is separate from the activity so app switches and screen-off do
  not drop the tunnel. It is not a VPNService and does not alter the system VPN
  slot.

### Release and security

- Release build: `debuggable=false`, WebView debugging disabled, verbose request
  logging and debug toolbar buttons removed, signing key project-local and
  gitignored, `allowBackup=false`.
- Initial GitHub release: sign the non-debuggable release APK with the existing
  project-local signing key. A production release keystore is deferred until
  app-store distribution or a permanent update channel is needed. Changing the
  signing key later requires users to uninstall and reinstall once.
- Version 1.0 (`versionName`/`versionCode`); signed APK as the release artifact.
- Only `INTERNET`, `POST_NOTIFICATIONS`, `FOREGROUND_SERVICE`,
  `FOREGROUND_SERVICE_SPECIAL_USE` and `USE_BIOMETRIC` permissions.
- No telemetry, analytics or crash upload. Logs stay on-device and are removed
  from release builds.
- The Android build should be reproducible with the project-local toolchain;
  adding an Android CI job is a release task if the hosted runner can install
  the SDK without loosening the project-local cache rule.

## Testing

- Go unit tests for the new mobile vault/profile/connection bridge and existing
  vault tests.
- Pixel manual matrix on the disposable profile:
  - first-run vault creation with and without a password
  - import `.conf`, edit profile, switch active profile, delete profile
  - connect, dashboard, external-content off/on, Basic auth (OpenCode)
  - Glances, Pi-hole, portfolio lightbox, Jellyfin playback/fullscreen
  - public link switch off blocks; on opens the system browser; LAN links stay
    in the WebView
  - background/screen-off lock on and off; auto-connect on and off;
    notification Stop; return, unlock and reload
  - export/import the encrypted vault and restore it on a clean install
  - biometrics off/on, password fallback, and lock-on-background after a
    biometric unlock
  - app restart, process death and Retry
  - system autofill with Bitwarden
  - confirm ProtonVPN remains usable and the app does not appear as a VPN
- Release APK install and launch on the Pixel without adb debugging enabled.

## Approaches considered

1. **Activity-bound tunnel, core scope.** Simplest, but every app switch drops
   the tunnel; switching to a password manager or answering a message loses the
   page state. Rejected for 1.0.
2. **Foreground service + core scope (chosen).** Keeps the tunnel across short
   app switches and screen-off, with a visible Stop action and no VPN slot. More
   lifecycle code, but the mobile-correct behaviour.
3. **Full desktop parity.** Adds saved-password capture/fill and link settings
   before 1.0. Rejected for 1.0 because Android autofill already covers logins
   and the extra work delays release.
4. **GeckoView or another bundled engine.** Rejected after the native-host fix:
   the system WebView renders every tested site correctly once it is outside
   Compose.

## Decisions

- **Lifecycle:** foreground service while connected; the tunnel survives app
  switches and screen-off. Stop is explicit (toolbar or notification).
- **Scope:** core 1.0; no in-app saved-password capture/fill (system autofill
  instead).
- **Public links:** global switch, default off; LAN links stay in the WebView;
  public top-level links are blocked when off and open in the system browser
  when on.
- **Lock:** optional lock-on-background switch, default on for password vaults;
  keyfile vaults have no lock screen. The service keeps the tunnel until Stop.
- **Fingerprint:** optional, off by default; BiometricPrompt with an
  Android Keystore-backed token and the password as the fallback.
- **Auto-connect:** settings switch, default off.
- **Backup/migration:** encrypted vault export/import via SAF.
- **Release signing:** for the initial GitHub release, sign a non-debuggable
  APK with the existing local signing key; defer a production keystore until
  app-store distribution or a permanent update channel is needed.
- **Loopback proxy:** unauthenticated but bound to a random `127.0.0.1` port
  only while connected. Accepted 1.0 risk; not exposed system-wide.

## 1.0 scope

1. Extend `core/mobile` with vault, profile, settings, export/import and
   connection APIs; add Go tests.
2. Build the first-run/setup, unlock, profile list/editor and settings UI
   (public-link switch, lock-on-background, auto-connect, export/import).
3. Build the connect flow and native WebView screen with toolbar, public-link
   routing, Basic auth, fullscreen and error/retry.
4. Add the foreground service, notification, lifecycle, auto-connect,
   lock-on-background handling and optional fingerprint unlock.
5. Build a non-debuggable APK signed with the existing local key, and test the
   signed APK on the Pixel.
6. Release 1.0 with updated docs and backlog.
