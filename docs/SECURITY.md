# Security

This is pre-release software. There is no supported release yet.

## Reporting

Once the repository is hosted, use a private security advisory for
vulnerabilities. Please do not open a public issue for something exploitable.

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
- The app does not listen on a network interface.
- Logs do not contain URLs, keys or dashboard content by default.
- The dashboard browser is LAN-only unless the user turns on external
  content.

## Secrets at rest

- The vault is encrypted with XChaCha20-Poly1305 under a random 256-bit key.
- Password mode derives the key with Argon2id.
- Convenience mode stores the key in a `0600` file. It is only as strong as
  the device account and is not suitable for a USB stick.
- Keys are never written to logs or crash reports.
- Real configs and vaults belong in `local/`, which is gitignored. A secret
  found in git history is treated as leaked and must be replaced.

## Saved passwords and the clipboard

- Saved logins are part of the vault payload and use the same
  XChaCha20-Poly1305 envelope as tunnel configs and the security policy.
- A profile summary never includes a password. The dashboard toolbar renderer
  receives names, URLs and usernames only.
- Copying asks the core for one credential over the `0600` control socket; the
  Electron main process writes the value to the clipboard and never sends it
  to a renderer.
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
- Security policy lives in the vault: Force LAN-only, idle lock and the idle
  minutes value. It is tamper-evident and travels with the vault.
- Force LAN-only is enforced by the core at connect time, not only by the UI.
- A missing or edited `settings.json` cannot widen network access; the
  security policy and profile external origins remain in the vault.

## Browser hardening

- Dashboard content runs in a separate Electron session with no Node
  integration, no file access and no API exposed to the page. A minimal
  isolated preload watches login submissions and reports a candidate to the
  main process; page scripts cannot call into it.
- Context isolation and the Chromium sandbox stay enabled.
- Remote debugging is disabled in release builds.
- New windows and popups are denied.
- Top-level navigation is limited to private addresses.
- Permissions are denied by default.
- HTTP and HTTPS requests are forced through the localhost proxy.
- Loopback destinations are blocked so a page cannot reach the app's own
  control socket or proxy.
- External content is opt-in, subresource-only and either exact-origin or an
  explicit allow-all mode. Top-level navigation is always private.
- External names are resolved by the proxy and dialed only when the result is
  a public address. Loopback, private, link-local and CGNAT results are
  refused.
- External traffic uses a direct dialer, never the WireGuard tunnel.

## Fail-closed behaviour

If the tunnel is down, LAN requests fail. There is no fallback to a direct
connection, the system VPN, or the host's LAN interface. If the proxy cannot
classify a destination, it refuses it. The only direct destinations are the
exact external origins a profile has opted into.

The reachability probe runs for the active profile at startup and on demand.
It dials only that profile's dashboard host and port, and only through the
tunnel. It is serialized with a real connection so two WireGuard devices never
use one profile at once, and it closes as soon as the dial finishes.

## App lock limitations

The app lock is a casual privacy screen. It stops someone who picks up the
device from opening the app and poking around. It does not turn the vault into
a defense against an attacker who can copy the files and run an offline
password search. A weak password such as `123` is still weak, and the UI says
so.

The dashboard padlock shows an opaque local lock view over a blurred snapshot
of the page, hides the live dashboard view, mutes its audio and disconnects the
tunnel. The snapshot is held in memory only and is never written to disk.
Unlocking reconnects and reloads the configured dashboard. The idle lock uses
the same path and pauses while the dashboard is audible, so media playback is
not cut off. Closing the dashboard window quits the app instead of leaving a
hidden tunnel behind.

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
- [x] Verify keys are absent from logs, the config file and crash output.
- [x] Verify the vault and key file permissions.
- [ ] Verify a failed handshake leaves the browser with no network access.

An early audit found Google endpoints opened by Electron's background
services. Blocking Chromium's own DNS removed them, and the real dashboard
still loaded through the proxy with the normal VPN active. Chromium's resolver
is now disabled with `host-resolver-rules`; anything that tries to look up a
name fails closed.
