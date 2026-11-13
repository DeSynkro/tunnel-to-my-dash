# Android

Android is a separate Kotlin/Compose client that reuses the shared Go core
through `gomobile`. It is not a port of the Electron shell.

The current APK is a **connectivity spike**:

- Pick a WireGuard `.conf` from the phone.
- Enter the dashboard URL.
- The Go core starts the userspace tunnel and the localhost HTTP proxy.
- The WebView uses AndroidX `ProxyController` to send all requests through
  that proxy.

There is no vault, lock screen or saved-password support in the spike yet.
The tunnel runs in the app process; no Android VPNService slot is used.

## Toolchain

Everything is project-local:

```
.tools/android-sdk/     SDK, platform-tools, build-tools, NDK
.tools/jdk-21/          Gradle JDK
.tools/gradle-8.9/      Gradle used for the wrapper
.tools/bin/gomobile
.cache/gradle/          Gradle cache
.cache/android-home/    adb keys
.cache/android/         debug keystore
platforms/android/app/build/     APK output
platforms/android/app/libs/      generated core AAR
```

Setup once:

```bash
make android-setup
```

Build:

```bash
make android-bind   # core.aar
make android-apk    # app-debug.apk
```

The APK is at
`platforms/android/app/build/outputs/apk/debug/app-debug.apk`. It is arm64
only and `minSdk` is 29 (Android 10), required by `ProxyController`.

## Install and test

With the S21 connected and USB debugging authorized:

```bash
make android-devices
make android-install
make android-logcat
```

The app logs under the `TTMD` tag. On the Pixel, copy the APK and install it
manually; allow “Install unknown apps” for the file manager and accept the
unsigned-build warning.

Test the dashboard, Jellyfin playback and fullscreen through the tunnel. If the
WebView proxy override does not work, the spike has done its job: we stop and
choose a fallback before building the full UI.
