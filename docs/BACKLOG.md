# Backlog

Ideas and follow-ups that are not part of the current phase. Move an item into
`docs/ROADMAP.md` when it is picked up.

## Interface

- Rebuild the UI with a proper design pass: more distinctive, professional and
  less like a utility template. This is the "unslop" pass.
- Design a new logo and distribution artwork: AppImage icon, window icon and
  any store or README images.

## App behaviour

- Add a Settings page from the main screen. It should cover changing the
  profile and dashboard URL, changing or removing the app password, and
  enabling or disabling the app lock.
- Add a confirm-password field to first-run setup and password changes. This
  prevents typos and lockouts.
- Offer a deliberate "open in normal browser" path for public dashboard
  links, instead of leaving them dead.

## Done

- Dashboard service tiles: Homarr-style `target="_blank"` links now open
  private http(s) URLs in a same-session child window. Public URLs stay
  blocked.

## Later

- External-content toggle and per-origin panel.
- Profile switcher UI.
- Jellyfin and OpenCode checks.
- Friendly tunnel error pages and reconnect.
- GPG-signed release artifacts.
- Automated network audit in CI.
