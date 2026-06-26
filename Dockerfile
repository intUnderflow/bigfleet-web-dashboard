# syntax=docker/dockerfile:1.7

ARG NODE_VERSION=22
ARG GO_VERSION=1.26
# BIGFLEET_REF pins the sister repo we depend on for the coordinator proto types.
# Override to a tag/commit for release builds.
ARG BIGFLEET_REF=main
# BASE_PATH bakes a reverse-proxy path prefix (e.g. /fleet-dash/) into the SPA's
# asset, router, and API paths. Default "/" = standalone at root. Build a
# prefixed image once with --build-arg BASE_PATH=/fleet-dash/ (see README); it
# assumes a prefix-stripping proxy.
ARG BASE_PATH=/

FROM node:${NODE_VERSION}-alpine AS ui-builder
WORKDIR /app
COPY ui/package.json ui/package-lock.json* ./
RUN npm ci --no-audit --no-fund
COPY ui ./
ARG BASE_PATH
RUN BASE_PATH=${BASE_PATH} npm run build

FROM golang:${GO_VERSION}-alpine AS go-builder
RUN apk add --no-cache git
ARG BIGFLEET_REF
WORKDIR /src

# Clone the sister repo so the `replace github.com/intUnderflow/bigfleet => ../bigfleet`
# directive in go.mod resolves the same way it does in dev.
RUN git clone --depth 1 --branch ${BIGFLEET_REF} https://github.com/intUnderflow/bigfleet.git

WORKDIR /src/bigfleet-web-dashboard
COPY go.mod go.sum ./
RUN go mod download
COPY . .
COPY --from=ui-builder /app/dist ./pkg/server/spa
RUN CGO_ENABLED=0 GOOS=linux go build \
    -tags embed_ui \
    -trimpath \
    -ldflags="-s -w" \
    -o /out/bigfleet-web-dashboard \
    ./cmd/bigfleet-web-dashboard

FROM gcr.io/distroless/static-debian12:nonroot
LABEL org.opencontainers.image.source="https://github.com/intUnderflow/bigfleet-web-dashboard"
LABEL org.opencontainers.image.description="Web dashboard for BigFleet"
LABEL org.opencontainers.image.licenses="MIT"

COPY --from=go-builder /out/bigfleet-web-dashboard /usr/local/bin/bigfleet-web-dashboard
USER 65532:65532
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/bigfleet-web-dashboard"]
