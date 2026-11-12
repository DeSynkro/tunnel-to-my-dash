# Android

Android will be a separate client, not a port of the Electron shell:

- Kotlin and Jetpack Compose UI.
- System WebView for the dashboard.
- The shared Go core through `gomobile`, once the core can run on Android.
- The same vault and WireGuard profile format. The vault stays app-managed;
  there is no OS keyring dependency.

This directory is a placeholder until the Android feasibility spike. Windows
comes first.
