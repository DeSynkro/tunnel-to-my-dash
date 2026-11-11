SHELL := /bin/bash

ROOT := $(CURDIR)
CACHE := $(ROOT)/.cache
TMP := $(ROOT)/.tmp

export TMPDIR := $(TMP)
export GOCACHE := $(CACHE)/go-build
export GOMODCACHE := $(CACHE)/go-mod
export GOPATH := $(CACHE)/go
export npm_config_cache := $(CACHE)/npm
export ELECTRON_CACHE := $(CACHE)/electron
export ELECTRON_BUILDER_CACHE := $(CACHE)/electron-builder

.PHONY: help dirs env clean

help: ## List available targets
	@awk 'BEGIN {FS = ":.*## "; printf "Targets:\n"} /^[a-zA-Z0-9_-]+:.*## / {printf "  %-10s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

dirs:
	@mkdir -p "$(CACHE)" "$(TMP)"

env: dirs ## Show the project-local build environment
	@printf 'GOCACHE=%s\nGOMODCACHE=%s\nGOPATH=%s\nTMPDIR=%s\nnpm_config_cache=%s\n' \
		"$(GOCACHE)" "$(GOMODCACHE)" "$(GOPATH)" "$(TMPDIR)" "$(npm_config_cache)"

clean: ## Remove build output and local caches
	@rm -rf "$(ROOT)/build" "$(ROOT)/dist" "$(CACHE)" "$(TMP)"
	@printf 'Removed build output and local caches.\n'
