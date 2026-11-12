# Backlog

Everything still left before the Windows and Android ports. Check items off as
they land, and keep the Done section for the record.

## Repo housekeeping

- [ ] Rebase and rerun the four Dependabot PRs: setup-node 4→7, checkout 4→7,
  upload-artifact 4→7, and golang.org/x/crypto 0.57→0.58. They predate the CI
  fixes.

## Done

- Hosted CI: the build workflow is green on `2c3c649` — core checks, desktop
  build, no-dashboard strace audit, AppImage, checksums and artifact. The
  audit caught Chromium downloading its spellcheck dictionary; the
  spellchecker is disabled at session creation and the default session is
  pinned to a loopback proxy.
- Auto-hide toolbar: hover expansion is ignored while the dashboard window is
  inactive, so hovering the peek pill on an unfocused window no longer
  flickers between expanding and the unfocused collapse. The `toolbarblur`
  smoke covers it.
- Tunnel drop and reconnect: with Wi-Fi fully off, Home/Reload shows “The
  dashboard is taking too long” after the 20-second watchdog, and retry
  recovers. The earlier “nothing” test was ambiguous because the established
  WireGuard session could still reach the LAN after the WAN dropped.
- Link settings: public http(s) links can open in the system browser, and
  dashboard links that ask for a new window can open in a separate app window
  on the same tunnel. Both are off by default. The separate window is plain
  (no toolbar, lock or saved-password fill) and closes when the dashboard locks
  or closes. The `links` smoke covers both settings.
- Peek pill contrast: a dark edge and slightly stronger fill keep the pill
  visible over light dashboards.
- Toolbar Fill uses the focused login form on pages with several forms, then
  falls back to the first visible form. The capture smoke covers the
  two-form case.
- Dashboard navigation resilience: Home and Reload start the same 20-second
  watchdog as the initial load; a proxy 5xx response shows the local error
  card immediately. Retry reconnects and reloads. The `navhang` smoke covers a
  502, a stalled proxy and recovery.
- Failed dashboard unlock: if the tunnel cannot reconnect after the password
  is accepted, the vault is locked again and the lock screen shows a friendly
  error instead of the raw IPC message. A later retry works; the `unlockfail`
  smoke covers it.
- Real-world checks: Jellyfin playback and HTML fullscreen pass in the
  packaged build, and the user reports everything plays correctly; a remote
  network over a phone hotspot passes on an earlier build, and the networking
  path is unchanged since.
- Automated network audit: a no-dashboard launch runs under Xvfb with a fresh
  data directory and fails on any non-loopback TCP/UDP connection from the
  app tree. CI uses strace; `make audit-network` can fall back to `ss` locally.
- Friendly errors and reconnect: a dashboard that fails to load or hangs for
  20 seconds shows a local card with Try again and Main menu; retry reconnects
  and reloads. A failed tunnel connect shows a native retry dialog instead of
  only an inline note.
- Fullscreen: HTML fullscreen is allowed in the dashboard session, the window
  enters fullscreen, the toolbar hides, and exiting restores the toolbar row.
- Saved passwords: per-profile logins in the encrypted vault, edited in the
  profile screen and copied from a key panel in the dashboard toolbar. The
  password only travels from the core to the clipboard, clears after 30
  seconds if unchanged, and clears on lock.
- Password fill and toolbar delete: matching-origin logins get a Fill button
  in the toolbar and a Fill pill beside the focused username or password
  field; both fill without submitting. Each toolbar row has a two-step ×
  delete.
- Login save prompt: submitting a login in the dashboard offers a native Save
  password dialog with the service name and origin. Exact duplicates are
  ignored, a changed password offers an update, and Not now is remembered for
  the session. With nothing saved, the toolbar key button flashes red and
  shows an empty-state bubble.
- Saved-password hardening: the clipboard clears on every vault lock and is
  serialized; capture requires a trusted gesture and waits for a page change
  or for the submitted password field to disappear; same-origin updates are
  disambiguated; save failures are shown; credential URLs with userinfo are
  rejected.
- SPA login success: the capture preload watches the submitted password field
  and signals success when it disappears, so logins that stay on the same path
  can offer to save.
- Saved-password coverage: SPA success, clipboard clearing on dashboard lock,
  main-window lock, idle lock and quit, the Not now path, toolbar and inline
  fill, the origin guard, and URL-matching unit tests.
- Brand integration: the house mark in the masthead and lock screen, the
  window and AppImage icon rendered from the logo, the README banner, and the
  neutral graphite + amber palette with green/red status dots across the main
  screen, toolbar and lock overlay.
- Reachability dot: the active profile is probed automatically once at
  startup, and clicking the dot re-checks it. It dials the dashboard host and
  port through the tunnel and shows green or red with no label. The probe is
  serialized with a real connection and closes immediately.
- Interface pass: app-scale rail layout, ink neutral palette, off-white
  primary actions, sentence-case labels, 4px spacing and a route-line
  signature. The in-app wordmark and route mark are in place.
- Behavior settings in plaintext `settings.json`: open the last dashboard
  after launch and after every unlock.
- Auto-hide is a centered, floating glass bar with a small peek pill. Hovering
  the pill animates the bar open, and moving away returns it to the pill. It
  also returns when the dashboard window regains focus. With auto-hide on, the
  pill and bar overlay the dashboard. Turning auto-hide off gives the bar a
  plain full-width row, so it covers nothing and has no floating pill frame.
- Dashboard window X quits the whole app; the Main menu button returns to the
  main menu. The toolbar has Main menu and a labeled Lock button on the right.
- Padlock lock overlay: it covers the dashboard with a blurred snapshot of
  the page behind an opaque card, disconnects the tunnel and reloads the same
  dashboard after unlock. The X quits while locked. Back to main menu
  suppresses auto-open once, so the next unlock lands on the main menu.
- Vault security settings: Force LAN-only for all profiles and lock after
  idle with a minutes value. Idle lock pauses while the dashboard is audible.
  Force LAN-only greys out profile external options and overrides them in the
  backend. Profile cards show the effective external-content mode.
- Settings uses a card layout: Behavior and Security on top, App lock full
  width, with the vault/settings.json note below.
- Profile editing moved to its own screen with an Edit action next to Open
  dashboard and Delete.
- Per-profile external content has three modes: LAN only, allow all external
  content, or exact origins. External traffic uses the normal network or VPN,
  never the tunnel; top-level navigation stays private.
- The tagline is now "Keep your VPN. Reach your LAN."
- Confirm-password field in first-run setup and in password changes.
- Dashboard toolbar with back, forward, reload, home and App, plus the
  current host label. The bar is 36px high.
- Back-to-app button returns to the profile list; closing the dashboard
  window does the same.
- Homarr-style `target="_blank"` service links now navigate in the same
  dashboard view for private http(s) URLs. Public URLs stay blocked.

## Deferred after Linux v1

- Launch at login on Linux. An autostart `.desktop` is easy to write, but the
  AppImage path can move and the file lives outside the portable folder.
- Start minimized and close to tray. The artwork is in place; the tray menu
  and lifecycle still need design.
- Decide lock-on-leave semantics: Main menu button versus minimize/background.
- Advanced tunnel details panel: endpoint, proxy, handshake age and last
  probe result.
- Profile switcher UI while a dashboard is open.
- Evaluate an ad/tracker blocker. uBlock Origin's MV2 build does not load in
  current Chromium; possible routes are an MV3 blocker or a filter-list proxy.
  Keep it off by default and do not phone home for filter updates.
- Move the navigation bar into the main app window and embed the dashboard in
  the shell instead of a separate dashboard window. Larger UI refactor.
- Self-signed certificate trust for LAN HTTPS services.
- mDNS names such as `homeassistant.local`.
- Optional direct mode when already on the home LAN.
- Inline fill for login forms inside iframes.
- GPG-signed release artifacts, once the app is distributed beyond personal
  use. SHA-256 checksums cover corruption; a release key adds provenance but
  brings key management with it.

## Windows

- [x] Platform layout under `platforms/windows`.
- [x] Control transport: owner-only named pipe on Windows, Unix socket on
  Linux. The named-pipe core tests pass under Wine.
- [x] Portable `.exe` build config, `.ico`, PowerShell build script and a
  `windows-latest` CI job.
- [ ] Test the portable `.exe` on the Windows laptop: first run, data beside
  the executable, dashboard over the tunnel, lock/unlock, and links.
- [ ] Add a Windows no-dashboard network audit and packaged smoke automation.
- [ ] Decide whether an installer is wanted; portable first.

## Android

- Feasibility spike: Kotlin/Compose, system WebView and the Go core through
  `gomobile`.
- Decide lifecycle, vault storage and tunnel ownership on Android.
