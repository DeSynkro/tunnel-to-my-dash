# Tunnel to My Dash 1.1.1

A small maintenance update on top of 1.1.0. There are no new features or
settings, and no vault or profile changes.

## Updates

- Updated Electron from 45.3.0 to 45.3.3 on desktop, including its Node.js
  24.22.3 runtime and DevTools/canvas fixes.
- Updated `golang.org/x/crypto` from 0.58.0 to 0.59.0 in the core, with the
  matching `x/net` and `x/sys` updates.
- Updated the CI actions `actions/cache` to 6.1.0 and `actions/setup-go` to
  7.0.0. These affect only the build workflow.

The 1.1.0 security work remains in place: the hardened browser boundary,
redirect policy, browser-state clearing, HTTPS default for external content,
bounded Argon2id parameters, desktop proxy authentication, IPC validation and
the dedicated Android release signing key.

## Downloads

| Platform | Artifact |
| --- | --- |
| Linux | AppImage |
| Windows | Portable `.exe` |
| Android | APK |

Verify the published SHA-256 checksums and the Android certificate fingerprint.

## Upgrading

- Desktop: install over the previous version.
- Android 1.1.x: install over the previous version.
- Android 1.0: export the vault, uninstall 1.0, install 1.1.1 and import the
  vault. The signing key changed in 1.1.

Dashboard logins may still need to be entered again after lock or quit because
browser state is cleared.
