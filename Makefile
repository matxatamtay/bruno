SHELL := /bin/zsh
.SHELLFLAGS := -lc

NVM_INIT := source ~/.nvm/nvm.sh && nvm use
RUN := $(NVM_INIT) && unset ELECTRON_RUN_AS_NODE &&
SANDBOX_BUNDLE := packages/bruno-js/src/sandbox/bundle-browser-rollup.js

.PHONY: help setup sandbox ensure-sandbox dev web electron build-web build-mac build-win clean-dev-env

help:
	@echo "Available commands:"
	@echo "  make dev       Run Bruno with web dev server + Electron"
	@echo "  make web       Run only the Bruno web dev server"
	@echo "  make electron  Run only Electron, expecting web server on port 3000"
	@echo "  make sandbox   Bundle JS sandbox libraries"
	@echo "  make setup     Install deps, build packages, and bundle sandbox"
	@echo "  make build-web Build the Bruno web renderer"
	@echo "  make build-mac Build the macOS Electron app"
	@echo "  make build-win Build the Windows Electron app"

dev: ensure-sandbox
	$(RUN) npm run dev

web:
	$(RUN) npm run dev:web

electron:
	$(RUN) BRUNO_DEV_PORT=3000 npm run dev:electron

sandbox:
	$(RUN) npm run sandbox:bundle-libraries --workspace=packages/bruno-js

ensure-sandbox:
	@if [ ! -f "$(SANDBOX_BUNDLE)" ]; then \
		echo "JS sandbox bundle missing. Building it now..."; \
		$(RUN) npm run sandbox:bundle-libraries --workspace=packages/bruno-js; \
	fi

setup:
	$(RUN) npm run setup

build-web:
	$(RUN) npm run build:web

build-mac: build-web
	$(RUN) npm run build:electron:mac

build-win: build-web
	$(RUN) npm run build:electron:win

clean-dev-env:
	@echo "Unset ELECTRON_RUN_AS_NODE in your current shell with:"
	@echo "  unset ELECTRON_RUN_AS_NODE"
