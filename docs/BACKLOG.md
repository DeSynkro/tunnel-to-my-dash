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
- Let dashboard service tiles open in the app. Homarr-style dashboards use
  `target="_blank"` for their service links; the dashboard window currently
  denies all new windows, so the tiles do nothing. Allow private http(s) URLs
  in a same-session child window and keep public URLs blocked.
- Offer a deliberate "open in normal browser" path for public dashboard
  links, instead of leaving them dead.

## Later

- External-content toggle and per-origin panel.
- Profile switcher UI.
- Jellyfin and OpenCode checks.
- Friendly tunnel error pages and reconnect.
- GPG-signed release artifacts.
- Automated network audit in CI.
