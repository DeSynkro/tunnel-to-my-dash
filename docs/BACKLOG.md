# Backlog

Ideas and follow-ups that are not part of the current phase. Move an item into
`docs/ROADMAP.md` when it is picked up.

## Interface

- Give the peek pill a visible edge over light dashboards. Its light fill
  disappears against a white page; a darker fill or a thin border would fix
  it without changing the dark-theme look.
- Move the navigation bar into the main app window and embed the dashboard in
  the shell instead of a separate dashboard window. This is a larger UI
  refactor and belongs with the unslop pass.


## App behaviour

- Offer a deliberate "open in normal browser" path for public dashboard
  links, instead of leaving them dead.
- Let users choose whether dashboard links open in the same window or in a
  new window. Same-window is the current default.
## Done

- Saved passwords: per-profile logins in the encrypted vault, edited in the
  profile screen and copied from a key panel in the dashboard toolbar. The
  password only travels from the core to the clipboard, clears after 30
  seconds if unchanged, and clears on lock. No autofill.
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

## Later

- Launch at login on Linux. An autostart `.desktop` is easy to write, but the
  AppImage path can move and the file lives outside the portable folder, so it
  is deferred.
- Start minimized and close to tray. These need a tray icon and menu; defer
  until the distribution artwork work.
- Decide lock-on-leave semantics: Main menu button versus minimize/background.
- Advanced tunnel details panel: endpoint, proxy, handshake age and last
  probe result.
- Profile switcher UI while a dashboard is open.
- Jellyfin playback test inside the app.
- Friendly tunnel error pages and reconnect.
- Evaluate an ad/tracker blocker. uBlock Origin's MV2 build does not load in
  current Chromium; possible routes are an MV3 blocker or a filter-list proxy.
  Keep it off by default and do not phone home for filter updates.
- GPG-signed release artifacts.
- Automated network audit in CI.
