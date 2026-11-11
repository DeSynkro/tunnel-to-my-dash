# Backlog

Ideas and follow-ups that are not part of the current phase. Move an item into
`docs/ROADMAP.md` when it is picked up.

## Interface

- Rebuild the UI with a proper design pass: more distinctive, professional and
  less like a utility template. This is the "unslop" pass.
- Design a new logo and distribution artwork: AppImage icon, window icon and
  any store or README images.
- Auto-hide the dashboard toolbar when the pointer is away from the top edge,
  and reveal it on hover after a short delay. Needs cursor polling or a
  hover strip that does not block clicks on the page.
- Move the navigation bar into the main app window and embed the dashboard in
  the shell instead of a separate dashboard window. This is a larger UI
  refactor and belongs with the unslop pass.

## App behaviour

- Add a Settings page from the main screen. It should cover changing the
  profile and dashboard URL, changing or removing the app password, and
  enabling or disabling the app lock.
- Add a confirm-password field to first-run setup and password changes. This
  prevents typos and lockouts.
- Offer a deliberate "open in normal browser" path for public dashboard
  links, instead of leaving them dead.
- Let users choose whether dashboard links open in the same window or in a
  new window. Same-window is the current default.

## Done

- Dashboard toolbar with back, forward, reload, home and App, plus the
  current host label. The bar is 36px high.
- Back-to-app button returns to the profile list; closing the dashboard
  window does the same.
- Homarr-style `target="_blank"` service links now navigate in the same
  dashboard view for private http(s) URLs. Public URLs stay blocked.

## Later

- External-content toggle and per-origin panel.
- Profile switcher UI.
- Jellyfin and OpenCode checks.
- Friendly tunnel error pages and reconnect.
- GPG-signed release artifacts.
- Automated network audit in CI.
