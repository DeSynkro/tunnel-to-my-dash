SHELL := /bin/bash

ROOT := $(CURDIR)
CACHE := $(ROOT)/.cache
TMP := $(ROOT)/.tmp
GO := $(ROOT)/.tools/go/bin/go

export TMPDIR := $(TMP)
export GOCACHE := $(CACHE)/go-build
export GOMODCACHE := $(CACHE)/go-mod
export GOPATH := $(CACHE)/go
export npm_config_cache := $(CACHE)/npm
export ELECTRON_CACHE := $(CACHE)/electron
export ELECTRON_BUILDER_CACHE := $(CACHE)/electron-builder
export PATH := $(ROOT)/.tools/go/bin:$(PATH)

.PHONY: help dirs env toolchain fmt test core check desktop-deps desktop-check audit-network desktop desktop-start appimage checksums release clean android-setup android-bind android-apk android-test android-install

help: ## List available targets
	@awk 'BEGIN {FS = ":.*## "; printf "Targets:\n"} /^[a-zA-Z0-9_-]+:.*## / {printf "  %-10s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

dirs:
	@mkdir -p "$(CACHE)" "$(TMP)"

env: dirs ## Show the project-local build environment
	@printf 'GOCACHE=%s\nGOMODCACHE=%s\nGOPATH=%s\nTMPDIR=%s\nnpm_config_cache=%s\n' \
		"$(GOCACHE)" "$(GOMODCACHE)" "$(GOPATH)" "$(TMPDIR)" "$(npm_config_cache)"

toolchain: ## Install the pinned Go toolchain into .tools/
	@platforms/linux/scripts/toolchain.sh

fmt: dirs ## Format Go code
	@test -d core || { echo "core/ not created yet"; exit 1; }
	@cd core && $(GO) fmt ./...

test: dirs ## Run Go tests
	@test -d core || { echo "core/ not created yet"; exit 1; }
	@cd core && $(GO) test ./...

core: dirs ## Build the core CLI
	@test -d core || { echo "core/ not created yet"; exit 1; }
	@mkdir -p build
	@cd core && $(GO) build -trimpath -o ../build/ttmd-core ./cmd/ttmd-core

check: test ## Format check, vet, tests and no-TUN guard
	@if [ "$$(id -u)" -eq 0 ]; then echo "error: run checks as a normal user"; exit 1; fi
	@out="$$(gofmt -l $$(find core -name '*.go' -type f))"; \
	if [ -n "$$out" ]; then echo "$$out"; echo "error: gofmt required"; exit 1; fi
	@cd core && $(GO) vet ./...
	@if grep -R --include='*.go' -n 'CreateTUN' core; then \
		echo "error: CreateTUN is not allowed"; exit 1; \
	fi

desktop-deps: dirs ## Install desktop dependencies
	@cd desktop && npm install
	@cd desktop && node node_modules/electron/install.js

desktop-check: dirs ## Type-check and build the desktop shell
	@cd desktop && npm run check

audit-network: core desktop-check ## Run the no-dashboard network audit
	@platforms/linux/scripts/audit-network.sh

desktop: desktop-check ## Build the desktop shell

desktop-start: desktop-check ## Run the desktop shell
	@cd desktop && npm start

appimage: core desktop-check ## Build the Linux AppImage
	@test -x desktop/node_modules/electron/dist/electron || { echo "error: Electron binary missing; run make desktop-deps"; exit 1; }
	@cd desktop && npm run dist

checksums: ## Write SHA-256 checksums for the AppImage
	@cd desktop/release && sha256sum *.AppImage > SHA256SUMS
	@cat desktop/release/SHA256SUMS

release: appimage checksums ## Build the AppImage and its checksums

android-setup: ## Install the project-local Android SDK, NDK, JDK and gomobile
	@platforms/android/setup.sh

android-bind: ## Build the Go core into an Android AAR
	@. platforms/android/env.sh && mkdir -p platforms/android/app/libs && cd core && gomobile bind -target=android/arm64 -androidapi 29 -o ../platforms/android/app/libs/core.aar ./mobile

android-apk: android-bind ## Build the debug Android APK
	@. platforms/android/env.sh && cd platforms/android && ./gradlew assembleDebug

android-test: android-bind ## Run Android unit tests
	@. platforms/android/env.sh && cd platforms/android && ./gradlew testDebugUnitTest

android-install: android-apk ## Install the debug APK on the connected device
	@platforms/android/adb install -r platforms/android/app/build/outputs/apk/debug/app-debug.apk

android-devices: ## List connected Android devices
	@platforms/android/adb devices

android-logcat: ## Show app and crash logs from the connected device
	@platforms/android/adb logcat -s TTMD:V AndroidRuntime:E

clean: ## Remove build output and local caches
	@rm -rf "$(ROOT)/build" "$(ROOT)/dist" "$(CACHE)" "$(TMP)"
	@printf 'Removed build output and local caches.\n'
