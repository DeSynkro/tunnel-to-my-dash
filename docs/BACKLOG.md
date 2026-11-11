# Backlog

Ideas and follow-ups that are not part of the current phase. Move an item into
`docs/ROADMAP.md` when it is picked up.

## Interface

- Design distribution artwork around the in-app route mark: AppImage icon,
  window icon and any store or README images.
- Move the navigation bar into the main app window and embed the dashboard in
  the shell instead of a separate dashboard window. This is a larger UI
  refactor and belongs with the unslop pass.

## App behaviour

- Offer a deliberate "open in normal browser" path for public dashboard
  links, instead of leaving them dead.
- Let users choose whether dashboard links open in the same window or in a
  new window. Same-window is the current default.

## Done

- Interface pass: app-scale rail layout, ink neutral palette, off-white
  primary actions, sentence-case labels, 4px spacing and a route-line
  signature. The in-app wordmark and route mark are in place.
- Auto-hiding dashboard toolbar: it hides after the pointer leaves the top
  edge and reappears after a short hover. The dashboard view fills the window
  and the bar overlays it.
- Per-profile external-content switch with an exact-origin panel. Allowed
  origins use the normal network or VPN, never the tunnel; everything else
  stays blocked.
- Settings screen: rename profiles, change dashboard URLs, change the app
  password, and turn the app lock on or off.
- Confirm-password field in first-run setup and in password changes.
- Dashboard toolbar with back, forward, reload, home and App, plus the
  current host label. The bar is 36px high.
- Back-to-app button returns to the profile list; closing the dashboard
  window does the same.
- Homarr-style `target="_blank"` service links now navigate in the same
  dashboard view for private http(s) URLs. Public URLs stay blocked.

## Later

- Profile switcher UI.
- Jellyfin playback test inside the app.
- Friendly tunnel error pages and reconnect.
- GPG-signed release artifacts.
- Automated network audit in CI.
