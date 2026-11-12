# Windows

Planned target: a portable `.exe` built with Electron Builder. The portable
target sets `PORTABLE_EXECUTABLE_DIR`, so the data directory can live beside the
executable, the same way the AppImage works on Linux.

Windows-specific work:

- The core control API will use a Windows named pipe; Linux keeps the Unix
  socket at `core/control.sock`.
- The packaged core is `ttmd-core.exe`; the app icon needs a `.ico`.
- The build runs on a `windows-latest` GitHub runner, not on the Linux host.
- The no-dashboard network audit will need a Windows equivalent.

The shared Electron app and Go core stay in `desktop/` and `core/`; only the
packaging and Windows integration live here.
