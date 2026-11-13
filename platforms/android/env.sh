# Android build environment. Source this for Android commands only; it keeps
# the SDK, JDK, Gradle cache and adb data inside the project.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

export ANDROID_HOME="$ROOT/.tools/android-sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export ANDROID_NDK_VERSION="27.2.12479018"
export ANDROID_NDK_HOME="$ANDROID_HOME/ndk/$ANDROID_NDK_VERSION"
export ANDROID_NDK_ROOT="$ANDROID_NDK_HOME"
export ANDROID_USER_HOME="$ROOT/.cache/android-home"
export GRADLE_USER_HOME="$ROOT/.cache/gradle"
export JAVA_HOME="$ROOT/.tools/jdk-21"
export GOPATH="$ROOT/.cache/go"
export GOMODCACHE="$ROOT/.cache/go-mod"
export GOBIN="$ROOT/.tools/bin"
export ANDROID_GRADLE_PROJECT="$ROOT/platforms/android"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin:$GOBIN:$ROOT/.tools/go/bin:$PATH"
