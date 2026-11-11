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

.PHONY: help dirs env toolchain fmt test core check desktop-deps desktop-check desktop desktop-start clean

help: ## List available targets
	@awk 'BEGIN {FS = ":.*## "; printf "Targets:\n"} /^[a-zA-Z0-9_-]+:.*## / {printf "  %-10s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

dirs:
	@mkdir -p "$(CACHE)" "$(TMP)"

env: dirs ## Show the project-local build environment
	@printf 'GOCACHE=%s\nGOMODCACHE=%s\nGOPATH=%s\nTMPDIR=%s\nnpm_config_cache=%s\n' \
		"$(GOCACHE)" "$(GOMODCACHE)" "$(GOPATH)" "$(TMPDIR)" "$(npm_config_cache)"

toolchain: ## Install the pinned Go toolchain into .tools/
	@scripts/toolchain.sh

fmt: ## Format Go code
	@test -d core || { echo "core/ not created yet"; exit 1; }
	@cd core && $(GO) fmt ./...

test: ## Run Go tests
	@test -d core || { echo "core/ not created yet"; exit 1; }
	@cd core && $(GO) test ./...

core: ## Build the core CLI
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

desktop-deps: ## Install desktop dependencies
	@cd desktop && npm install

desktop-check: ## Type-check and build the desktop shell
	@cd desktop && npm run check

desktop: desktop-check ## Build the desktop shell

desktop-start: desktop-check ## Run the desktop shell
	@cd desktop && npm start

clean: ## Remove build output and local caches
	@rm -rf "$(ROOT)/build" "$(ROOT)/dist" "$(CACHE)" "$(TMP)"
	@printf 'Removed build output and local caches.\n'
