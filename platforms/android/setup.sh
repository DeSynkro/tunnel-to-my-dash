#!/usr/bin/env bash
# Install the Android SDK, NDK, JDK and gomobile inside the project.
# Everything lands under .tools/ and .cache/; no sudo and no $HOME changes.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=platforms/android/env.sh
source "$ROOT/platforms/android/env.sh"

TOOLS="$ROOT/.tools"
DOWNLOADS="$ROOT/.cache/android-downloads"
CLI_VERSION="15859902"
CLI_URL="https://dl.google.com/android/repository/commandlinetools-linux-${CLI_VERSION}_latest.zip"
GRADLE_VERSION="8.9"
GRADLE_URL="https://services.gradle.org/distributions/gradle-${GRADLE_VERSION}-bin.zip"

mkdir -p "$TOOLS" "$DOWNLOADS" "$ANDROID_HOME" "$ANDROID_USER_HOME" "$GRADLE_USER_HOME" "$GOBIN"

fetch() {
    local url="$1" dest="$2"
    if [[ ! -s "$dest" ]]; then
        echo "Downloading $(basename "$dest")"
        curl --fail --location --retry 3 --output "$dest" "$url"
    fi
}

# JDK 21 from Adoptium, verified with the checksum from their API.
if [[ ! -x "$JAVA_HOME/bin/java" ]]; then
    assets="$DOWNLOADS/temurin21.json"
    fetch "https://api.adoptium.net/v3/assets/latest/21/hotspot?architecture=x64&image_type=jdk&os=linux&vendor=eclipse" "$assets"
    read -r JDK_URL JDK_SHA < <(python3 - "$assets" <<'PY'
import json, sys
asset = json.load(open(sys.argv[1]))[0]
package = asset["binary"]["package"]
print(package["link"], package["checksum"])
PY
)
    JDK_ZIP="$DOWNLOADS/$(basename "$JDK_URL")"
    fetch "$JDK_URL" "$JDK_ZIP"
    printf '%s  %s\n' "$JDK_SHA" "$JDK_ZIP" | sha256sum --check --status -
    rm -rf "$JAVA_HOME"
    mkdir -p "$JAVA_HOME"
    tar -xzf "$JDK_ZIP" -C "$JAVA_HOME" --strip-components=1
fi
echo "JDK: $("$JAVA_HOME/bin/java" -version 2>&1 | head -n 1)"

# Android command-line tools.
SDKMANAGER="$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager"
if [[ ! -x "$SDKMANAGER" ]]; then
    CLI_ZIP="$DOWNLOADS/commandlinetools-linux-${CLI_VERSION}_latest.zip"
    fetch "$CLI_URL" "$CLI_ZIP"
    rm -rf "$ANDROID_HOME/cmdline-tools/latest"
    mkdir -p "$ANDROID_HOME/cmdline-tools"
    unzip -q "$CLI_ZIP" -d "$ANDROID_HOME/cmdline-tools"
    mv "$ANDROID_HOME/cmdline-tools/cmdline-tools" "$ANDROID_HOME/cmdline-tools/latest"
fi

# sdkmanager closes stdin once it has enough answers; yes then exits with
# SIGPIPE. Disable pipefail only for this pipeline.
( set +o pipefail; yes | "$SDKMANAGER" --sdk_root="$ANDROID_HOME" --licenses >/dev/null )
"$SDKMANAGER" --sdk_root="$ANDROID_HOME" --install \
    "platform-tools" "platforms;android-35" "build-tools;35.0.0" "ndk;$ANDROID_NDK_VERSION"

# Gradle 8.9, used once to create the committed wrapper.
GRADLE_HOME="$TOOLS/gradle-$GRADLE_VERSION"
if [[ ! -x "$GRADLE_HOME/bin/gradle" ]]; then
    GRADLE_ZIP="$DOWNLOADS/gradle-${GRADLE_VERSION}-bin.zip"
    fetch "$GRADLE_URL" "$GRADLE_ZIP"
    GRADLE_SHA="$(curl --fail --location --silent "https://services.gradle.org/distributions/gradle-${GRADLE_VERSION}-bin.zip.sha256")"
    printf '%s  %s\n' "$GRADLE_SHA" "$GRADLE_ZIP" | sha256sum --check --status -
    unzip -q -o "$GRADLE_ZIP" -d "$TOOLS"
fi

mkdir -p "$ANDROID_GRADLE_PROJECT"
if [[ ! -f "$ANDROID_GRADLE_PROJECT/gradlew" ]]; then
    (cd "$ANDROID_GRADLE_PROJECT" && "$GRADLE_HOME/bin/gradle" wrapper --gradle-version "$GRADLE_VERSION" --distribution-type bin)
fi

# gomobile and its Android cache, pinned to the version in core/go.mod.
GOMOBILE_VERSION="$( cd "$ROOT/core" && "$ROOT/.tools/go/bin/go" list -m -f '{{.Version}}' golang.org/x/mobile )"
if [[ -z "$GOMOBILE_VERSION" ]]; then
    echo "error: could not determine the golang.org/x/mobile version" >&2
    exit 1
fi
( cd "$ROOT/core" && "$ROOT/.tools/go/bin/go" install "golang.org/x/mobile/cmd/gomobile@$GOMOBILE_VERSION" )
"$GOBIN/gomobile" init

# Debug keystore, project-local.
KEYSTORE="$ROOT/.cache/android/debug.keystore"
if [[ ! -f "$KEYSTORE" ]]; then
    mkdir -p "$(dirname "$KEYSTORE")"
    "$JAVA_HOME/bin/keytool" -genkeypair -v \
        -keystore "$KEYSTORE" -storepass android -alias androiddebugkey \
        -keypass android -keyalg RSA -keysize 2048 -validity 10000 \
        -dname "CN=Android Debug,O=Android,C=US" >/dev/null
fi

echo "Android toolchain ready."
"$SDKMANAGER" --version | head -n 1
( cd "$ROOT/core" && "$GOBIN/gomobile" version )
