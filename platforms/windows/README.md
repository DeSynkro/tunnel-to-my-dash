# Windows

The Windows target is a portable `.exe` built with Electron Builder. The
portable launcher sets `PORTABLE_EXECUTABLE_DIR`, so `tunnel-to-my-dash-data/`
lives beside the executable, the same way the AppImage works on Linux.

## Build

On a Windows machine with Node.js 24+ and Go 1.27.4:

```powershell
./platforms/windows/build.ps1
```

The script runs the Go tests, builds `build/ttmd-core.exe`, installs the desktop
dependencies, typechecks, and writes
`desktop/release/Tunnel-to-My-Dash-<version>-portable-x64.exe`.

The `windows-latest` CI job runs the same script and uploads the `.exe` with a
SHA-256 checksum. It does not need a code-signing certificate; Windows may show
a SmartScreen warning for an unsigned personal build.

## Control transport

Linux keeps the `0600` Unix socket at `core/control.sock`. Windows uses an
owner-only named pipe:

```
\\.\pipe\ttmd-<random>
```

The desktop app generates the name and passes `--socket` to `ttmd-core.exe`.
The pipe is restricted to the current user, so no loopback port is opened.

## Single instance and keys

- A second launch focuses the existing window and exits; the lock is per data
  directory, so two copies cannot open the same vault.
- Windows has no POSIX mode bits. Keyfile vaults inherit the data folder's ACL
  instead of a `0600` mode; use an app password on shared or removable media.

## Still to verify

- First run and data beside the executable on a real Windows machine.
- Dashboard, lock/unlock and links over the tunnel.
- A Windows no-dashboard network audit and packaged smoke automation.
