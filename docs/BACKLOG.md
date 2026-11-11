# Backlog

Ideas and follow-ups that are not part of the current phase. Move an item into
`docs/ROADMAP.md` when it is picked up.

## Interface

- Design distribution artwork around the in-app route mark: AppImage icon,
  window icon and any store or README images.
- Move the navigation bar into the main app window and embed the dashboard in
  the shell instead of a separate dashboard window. This is a larger UI
  refactor and belongs with the unslop pass.
- Auto-hide is still broken in a real session: it only hides when the window
  loses focus. The X11 pointer poll passes in the smoke pass, but global
  cursor polling is unreliable under Wayland, so the toolbar's own focus is
  currently the only thing that hides it. Replace the poll with pointer events
  sent from the dashboard and toolbar preloads, and retest on a real Wayland
  session.

## App behaviour

- Offer a deliberate "open in normal browser" path for public dashboard
  links, instead of leaving them dead.
- Let users choose whether dashboard links open in the same window or in a
  new window. Same-window is the current default.
- Per-profile credential quick-paste: an encrypted list of service names,
  URLs, usernames and passwords in the vault, with copy buttons from the
  dashboard toolbar. Clear the clipboard after 30 seconds and do not add
  autofill until the security model is settled.

## Done

- Reachability dot: the active profile is probed automatically once at
  startup, and clicking the dot re-checks it. It dials the dashboard host and
  port through the tunnel and shows green or red with no label. The probe is
  serialized with a real connection and closes immediately.
- Interface pass: app-scale rail layout, ink neutral palette, off-white
  primary actions, sentence-case labels, 4px spacing and a route-line
  signature. The in-app wordmark and route mark are in place.
- Behavior settings in plaintext `settings.json`: open the last dashboard
  after launch and after every unlock.
- Dashboard window X quits the whole app; the App button returns to the
  dashboard list. The toolbar now has App and a padlock on the right.
- Padlock lock overlay: it covers the dashboard, disconnects the tunnel and
  reloads the same dashboard after unlock. The X quits while locked.
- Vault security settings: Force LAN-only for all profiles and lock after
  idle with a minutes value. Idle lock pauses while the dashboard is audible.
  Force LAN-only greys out profile external options and overrides them in the
  backend. Profile cards show the effective external-content mode.
- Settings is a two-column layout: Behavior and Application on the left,
  App lock and Security on the right, with the vault/settings.json note.
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
- Decide lock-on-leave semantics: App button versus minimize/background.
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
