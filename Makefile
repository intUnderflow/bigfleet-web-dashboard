SHELL := /usr/bin/env bash
GO ?= go
NPM ?= npm

UI_DIR := ui
SPA_DIR := pkg/server/spa
BIN := bin/bigfleet-web-dashboard

.PHONY: help
help:
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  %-18s %s\n",$$1,$$2}'

.PHONY: backend
backend: ## Build the Go binary (no UI embed)
	$(GO) build -o $(BIN) ./cmd/bigfleet-web-dashboard

$(UI_DIR)/node_modules: $(UI_DIR)/package.json
	cd $(UI_DIR) && $(NPM) install
	@touch $(UI_DIR)/node_modules

.PHONY: ui-deps
ui-deps: $(UI_DIR)/node_modules ## Install npm deps

.PHONY: ui-dev
ui-dev: $(UI_DIR)/node_modules ## Run vite dev server (proxies /api → :8080)
	cd $(UI_DIR) && $(NPM) run dev

.PHONY: ui-build
ui-build: $(UI_DIR)/node_modules ## Build the SPA into $(SPA_DIR)
	cd $(UI_DIR) && $(NPM) run build
	rm -rf $(SPA_DIR) && mkdir -p $(SPA_DIR)
	cp -r $(UI_DIR)/dist/. $(SPA_DIR)/

.PHONY: build
build: ui-build ## Build single binary with UI embedded
	$(GO) build -tags embed_ui -o $(BIN) ./cmd/bigfleet-web-dashboard

.PHONY: test
test:
	$(GO) test -race ./...

.PHONY: lint
lint:
	$(GO) vet ./...
	cd $(UI_DIR) && $(NPM) run typecheck

.PHONY: tidy
tidy:
	$(GO) mod tidy

CHART_DIR := deploy/helm/bigfleet-web-dashboard
IMAGE ?= ghcr.io/intunderflow/bigfleet-web-dashboard:dev

.PHONY: docker
docker: ## Build the container image locally
	docker build -t $(IMAGE) .

.PHONY: helm-lint
helm-lint: ## helm lint the chart
	helm lint $(CHART_DIR)

.PHONY: helm-template
helm-template: ## helm template the chart (smoke-renders all resources)
	helm template bigfleet-web-dashboard $(CHART_DIR)

.PHONY: clean
clean:
	rm -rf bin/ $(SPA_DIR) $(UI_DIR)/dist $(UI_DIR)/node_modules
