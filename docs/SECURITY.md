# Security

This document describes the security model for the 1.1 release. It is not an
independent audit and does not claim to be one.

## Reporting

Use the repository's private security advisory for vulnerabilities. Please do
not open a public issue for something exploitable.

## What we are protecting

- The WireGuard private key, preshared key and any saved service tokens.
- Access to the user's LAN services while the app is open.
- The user's normal VPN, routing table and system configuration, which the app
  never changes.
- The user's browsing habits from third-party tracking in the default mode.

## Threat model

In scope:

- Someone picks up an unlocked phone or laptop and opens the app.
- The app is used on an untrusted network.
- A dashboard or LAN page is malicious or has been compromised.
- A portable data folder or USB stick is lost.
- A third-party font or widget tries to track the user.
- The tunnel drops unexpectedly.

Out of scope:

- A compromised operating system, kernel, or root account.
- An attacker who can read process memory or debug the app.
- Physical coercion.
- A malicious WireGuard endpoint or a compromised home network.
- Side-channel attacks against the host.

## Privacy rules

- No telemetry, analytics, advertising identifiers, accounts or cloud
  services.
- No crash uploads unless a future opt-in flow is added.
- No background update pings. Updates are checked manually.
- The app does not listen on a non-loopback network interface. The core proxy
  and control channel are loopback/app-local only.
- Logs do not contain URLs, keys or dashboard content by default.
- The dashboard browser is LAN-only unless the user turns on external
  content. External content requires HTTPS by default; LAN HTTP dashboards
  keep working.

## Secrets at rest

- The vault is encrypted with XChaCha20-Poly1305 under a random 256-bit key.
- Password mode derives the key with Argon2id.
- Convenience mode stores the key in a `0600` file. It is only as strong as
  the device account and is not suitable for a USB stick. On Windows the file
  inherits the data folder's ACL instead of POSIX `0600`; use an app password
  on shared or removable media.
- No OS keyring owns the vault key in 1.1. Password mode is the strongest
  portable option; keyfile mode is only as strong as the device account and
  app sandbox. Android fingerprint unlock protects a local Keystore-backed
  convenience token, not the vault key itself.
- An optional device-bound mode (Android Keystore, Windows DPAPI or Linux
  libsecret) is designed for 1.2. It is not shipped in 1.1 because it changes
  recovery semantics and must be tested against key invalidation and
  reinstall before it can be offered safely.
- Keys are never written to logs or crash reports.
- Real configs and vaults belong in `local/`, which is gitignored. A secret
  found in git history is treated as leaked and must be replaced.

## Release signing

- Android debug builds use the generated debug keystore. Release builds use a
  dedicated RSA 4096 key and fail if the signing environment is missing.
- The 1.1 release certificate is `CN=Tunnel to My Dash Release, OU=Android,
  O=DeSynkro, C=US`, SHA-256
  `43:D3:45:D8:97:73:4C:1C:1A:3B:0D:C7:7C:06:AE:4C:66:FF:B2:7B:B8:91:44:F1:C6:97:30:F6:5F:00:C0:13`.
- The key and its passwords are stored outside the repository. CI receives the
  keystore as a repository secret, verifies the certificate and rejects a
  debug-signed or debuggable APK.
- 1.0 was signed with a debug-profile key. Android cannot update across signing
  identities, so 1.0 users must export the vault, uninstall, install 1.1 and
  import the export. The old key is retired.

## Saved passwords and the clipboard

- Saved logins are part of the vault payload and use the same
  XChaCha20-Poly1305 envelope as tunnel configs and the security policy.
- A profile summary never includes a password. The dashboard toolbar renderer
  receives names, URLs and usernames only.
- Copying asks the core for one credential over the control channel; the
  Electron main process writes the value to the clipboard and never sends it
  to a renderer. Linux uses a `0600` Unix socket; Windows uses an owner-only
  named pipe.
- The clipboard is cleared after 30 seconds if it still matches the copied
  value, and cleared immediately on any vault lock (dashboard padlock,
  main-window lock or idle lock) or app quit.
- Login capture uses the same isolated preload. It reads the username,
  password, page title and origin on a trusted submit, Enter or login-button
  event (a recent real pointer or key gesture) and sends them to the main
  process. The candidate is held until the page navigates to a different path
  or the submitted password field disappears, so a failed login that reloads
  the same page does not prompt. The password stays in main memory for the
  native prompt and is never shown in the dialog.
- Candidates from subframes, non-private origins, a locked vault or malformed
  payloads are discarded. Exact duplicates are ignored. Matching normalizes
  saved URLs to their origin; an existing origin and username with a new
  password prompts to update, and ambiguous same-origin matches are refused
  rather than updated blindly.
- Fill is manual: it runs from the toolbar or from the inline pill, only when
  the saved origin matches the current page origin. The inline pill asks the
  main process whether a login matches and requests one fill on a real click.
  The secret goes from the main process to the isolated dashboard preload and
  into the page's own fields; the toolbar renderer never receives it. Fill
  never submits the form. The page can see the pill but cannot invoke it.
- There is no automatic fill on page load and no password reveal in the UI.
  Editing a saved login leaves the stored password untouched unless a new one
  is typed.

## Settings storage

- `settings.json` is plaintext and holds behavior only, such as whether to
  open the last dashboard after launch or auto-hide the toolbar. It is written
  `0600` and is safe to copy between machines.
- Security policy lives in the vault: Force LAN-only, idle lock, the idle
  minutes value and the external-content HTTPS requirement. It is
  tamper-evident and travels with the vault.
- Force LAN-only and the HTTPS requirement are enforced by the core at connect
  time, not only by the UI.
- A missing or edited `settings.json` cannot widen network access; the
  security policy and profile external origins remain in the vault.

## Browser hardening

- Dashboard content runs in a separate Electron session with no Node
  integration, no file access and no API exposed to the page. A minimal
  isolated preload watches trusted login submissions and reports a candidate
  to the main process; page scripts cannot call into it.
- The dashboard error card is local app content with its own sandboxed
  preload; it exposes only Retry and Main menu.
- Context isolation and the Chromium sandbox stay enabled.
- Remote debugging is disabled in release builds.
- New windows and popups are denied except private dashboard links when the
  user enables the new-window setting. That window uses the same sandboxed
  dashboard session and preload, has no Node access, is limited to private
  top-level URLs, and closes when the dashboard locks or closes.
- Top-level navigation is limited to private addresses. Public http(s) links
  can leave the app only through the system browser, and only when the user
  enables that setting. URLs with credentials and non-http(s) schemes are
  never passed to the browser.
- The navigation guard runs on both `will-frame-navigate` and `will-redirect`,
  so server redirects and meta refresh cannot move a private dashboard to a
  public or loopback page.
- Permissions are denied except HTML fullscreen, which dashboard media needs.
- HTTP and HTTPS requests are forced through the localhost proxy with
  Chromium's implicit loopback/link-local bypass disabled. The regression test
  covers IPv4 loopback, IPv6 loopback, link-local IPv4 and link-local IPv6.
- Android uses `ProxyConfig.Builder.removeImplicitRules()` plus a fail-closed
  URL guard that blocks loopback/link-local HTTP(S) requests from the WebView.
- External content is opt-in, subresource-only and either exact-origin or an
  explicit allow-all mode. Top-level navigation inside the dashboard is always
  private.
- Public external content requires HTTPS by default. The global setting can
  opt out for legacy HTTP widgets; LAN HTTP is unaffected.
- External names are resolved by the proxy and dialed only when the result is
  a public address. Loopback, private, link-local and CGNAT results are
  refused.
- External traffic uses a direct dialer, never the WireGuard tunnel.
- Desktop dashboard sessions use a per-run authenticated loopback proxy.
  Android keeps the loopback-only fallback until WebView proxy authentication
  is verified on a device; that limitation is documented below.
- Dashboard cookies, storage, cache and HTTP auth state are cleared on lock,
  close and quit. Desktop uses a non-persistent hashed partition and removes
  legacy `persist:profile-*` data at startup. Android clears WebView cookies
  and site storage when the dashboard is destroyed and once at cold start.

## Fail-closed behaviour

If the tunnel is down, LAN requests fail. There is no fallback to a direct
connection, the system VPN, or the host's LAN interface. If the proxy cannot
classify a destination, it refuses it. The only direct destinations are the
public origins a profile has opted into (all, or an exact list), and only over
HTTPS unless the user explicitly allows external HTTP.

Vault KDF parameters are bounded before any key derivation: Argon2id time is
capped at 10, memory at 128 MiB and threads at 16. A malicious vault or export
is rejected as corrupt instead of forcing an excessive CPU or memory request.
Existing vaults use much lower defaults.

The reachability probe runs for the active profile at startup and on demand.
It dials only that profile's dashboard host and port, and only through the
tunnel. It is serialized with a real connection so two WireGuard devices never
use one profile at once, and it closes as soon as the dial finishes.

## App lock limitations

The app lock is a casual privacy screen. It stops someone who picks up the
device from opening the app and poking around. It does not turn the vault into
a defense against an attacker who can copy the files and run an offline
password search. A weak password such as `123` is still weak, and the UI says
so. Only one app instance can use a data directory at a time; a second launch
focuses the existing window and exits.

The dashboard padlock shows an opaque local lock view over a blurred snapshot
of the page, hides the live dashboard view, mutes its audio and disconnects the
tunnel. The snapshot is held in memory only and is never written to disk.
Unlocking reconnects and reloads the configured dashboard, so the user may need
to sign in to the dashboard again. If the reconnect fails after the password is
accepted, the vault is locked again before the error is shown, so the lock
screen cannot leave it unlocked. The idle lock uses the same path and pauses
while the dashboard is audible, so media playback is not cut off. Closing the
dashboard window quits the app instead of leaving a hidden tunnel behind.

Dashboard cookies, localStorage, session data, cache and HTTP auth credentials
are cleared on lock, close and quit. Desktop uses an in-memory hashed
partition and deletes legacy persisted dashboard partitions at startup. Android
clears its WebView state when the dashboard is destroyed and once at cold
start, covering a process kill that skipped normal teardown.

## Build and supply chain

- CI actions are pinned to full commit SHAs, not moving major-version tags.
- Desktop dependencies install with `npm ci` from the committed lockfile.
- The Gradle 8.9 wrapper verifies the official distribution SHA-256, and the
  Android setup script pins the command-line tools ZIP as well.
- The JDK download is checked against Adoptium's published checksum, and
  `gomobile` is installed at the version recorded in `go.mod`.
- Packaged Electron builds disable `ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS` and
  Node inspector arguments, and load the app only from `app.asar`. Windows also
  enables embedded ASAR integrity validation.
- The packaged Linux AppImage was launched after applying the fuses; the app
  reached its setup screen and exited through the idle smoke path.

## DNS and WebView behaviour

- Desktop disables Chromium's resolver with `host-resolver-rules`, disables
  DoH/preconnect/DNS-prefetch, and sends HTTP and HTTPS through the local
  proxy, where the core resolves and validates external names. This prevents
  the dashboard browser from resolving names outside the tunnel path.
- The WireGuard endpoint hostname is resolved once before the userspace tunnel
  can exist. That is unavoidable for the first connection and is documented,
  not hidden.
- Android uses the system WebView proxy override. Dashboard URLs are LAN IP
  literals and external origins are exact, but WebView DNS and proxy
  authentication are controlled by the installed WebView provider. 1.1 has
  not run a packet-level Android DNS test, so it does not claim zero DNS
  leakage on Android. A DNS test matrix and WebView proxy-auth verification
  remain device-test work.

## Known limitations

- The Android proxy is loopback-only and unauthenticated in 1.1. Desktop uses a
  per-run token. Android proxy authentication is prepared but disabled until
  the WebView 407 path is verified on a device.
- Android DNS/WebView leakage has not been packet-tested. See the section
  above for the exact claim.
- No OS keyring owns the vault key in 1.1; optional device-bound storage is a
  1.2 design item.
- No independent security audit has been performed.
- Dashboard browser state is cleared on lock/quit, so dashboard logins may be
  required again. Saved app passwords remain in the vault.
- Android 1.1 uses a new release key; 1.0 users must export, uninstall, install
  1.1 and import.

## Audit checklist

- [x] Launch the app with no dashboard configured and capture outbound traffic.
      No TCP or UDP sockets were owned by Electron or the core for the whole
      eight-second audit.
- [x] Verify Chromium background networking and service hooks are disabled.
- [x] Verify the dashboard cannot navigate to a public page.
- [x] Verify loopback and public destinations are refused by the proxy.
- [x] Verify an allowed external origin loads directly and, in specific-origin
      mode, an unlisted origin gets a 403.
- [x] Verify top-level navigation to an external origin is blocked even when
      that origin is allowed for subresources.
- [x] Verify Force LAN-only overrides a profile's external-content mode in the
      connector options.
- [x] Verify the dashboard padlock disconnects the tunnel, hides the page and
      reconnects after unlock.
- [x] Verify idle lock triggers and reconnects after unlock.
- [x] Verify no TUN device is created and no elevated privileges are used.
- [x] Verify the AppImage runs with the Chromium sandbox enabled. The
      packaged build loaded the dashboard without `--no-sandbox`; only the
      usual GPU-worker sandbox warning appeared.
- The CI network audit runs Chromium with `--no-sandbox` because GitHub's
  Ubuntu runner restricts unprivileged user namespaces. That audit measures
  network traffic only; the packaged AppImage still runs sandboxed.
- [x] Verify keys are absent from logs, the config file and crash output.
- [x] Verify the vault and key file permissions.
- [x] Verify loopback and link-local requests use the proxy in guarded dashboard
      sessions, including an IPv6 loopback listener.
- [x] Verify a private-to-public 302, a private-to-loopback 302 and a meta
      refresh are blocked, while private redirects still load.
- [x] Verify oversized Argon2 time, memory and thread values are rejected
      before derivation.
- [x] Verify desktop dashboard cookies, storage and caches are gone after
      clearing. Android state clearing has compile/unit coverage; its device
      pass is still pending.
- [x] Verify HTTPS is required for external content by default and that LAN
      HTTP still works.
- [x] Verify the desktop proxy rejects missing credentials and accepts its
      per-run token for both HTTP and CONNECT.
- [x] Verify an unknown Electron webContents is rejected by privileged IPC.
- [x] Verify the signed 1.1 APK is not debuggable, uses the release certificate
      and fails closed when signing variables are absent.
- [x] Verify Electron fuses on the packaged Linux and Windows builds and launch
      the packaged AppImage.
- [ ] Verify a failed handshake leaves the browser with no network access.
- [ ] Run the Android WebView loopback/DNS matrix on a physical device.
- [ ] Verify Android WebView proxy authentication before enabling it.

An early desktop audit found Google endpoints opened by Electron's background
services. Blocking Chromium's own DNS removed them, and the real dashboard
still loaded through the proxy with the normal VPN active. Chromium's resolver
is now disabled with `host-resolver-rules`; anything that tries to look up a
name fails closed.

A later desktop audit caught Chromium downloading its en-GB spellcheck
dictionary from `redirector.gvt1.com`, which also triggered a DoH/preconnect
attempt to Google DNS. The spellchecker is now disabled when a session is
created, the default session is pinned to a dead loopback proxy, and preconnect
and DNS prefetch are off. Only the dashboard partition receives the tunnel
proxy. The real dashboard still loads through it. These are desktop findings;
the Android WebView DNS path is listed separately above.
