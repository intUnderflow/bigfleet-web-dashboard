# bigfleet-web-dashboard

A web dashboard for [BigFleet](https://github.com/intUnderflow/bigfleet) — the fleet-level Kubernetes infrastructure autoscaler.

BigFleet itself ships no in-tree web UI ("`kubectl` + structured logs + Prometheus is the bar," per the main repo's `docs/plan.md` §0). This repo is the consumption layer on top of that contract: a single Go binary that reads BigFleet's Prometheus metrics, calls the coordinator's read-only RPCs (with a `bigfleet://readonly` client certificate — ADR-0048/0060), and queries the `bigfleet.lucy.sh/v1alpha1` CRDs across managed clusters — and presents the result as six focused views.

## Status

v0 functional surface complete. All views are wired against real data sources.

| View | Route | Backed by |
|---|---|---|
| Fleet overview | `/` | Prometheus aggregates |
| Shards | `/shards`, `/shards/:pod` | Prometheus per-pod |
| Clusters | `/clusters`, `/clusters/:id` | Managed-cluster apiservers via `--kubeconfig` |
| Topology | `/topology` | Coordinator gRPC (`ListShards` / `ListDomainAssignments` / `ListQuotas`) + Prometheus coordinator metrics |
| Providers | `/providers` | Coordinator gRPC (`ListProviders`) |
| FinOps | `/finops` | Penalty-bucket × capacity-type heatmap (`docs/user-stories.md` red-flag query) |

The coordinator's leader-local soft-state snapshot is also exposed at `GET /api/shard-reports` (`ListShardReports`: latest `ShardSummary` + outstanding shortfalls per shard) and rendered in the Topology view.

Every endpoint returns 503 with an actionable message when its data source isn't wired; every endpoint degrades gracefully when wired-but-failing (per-cluster errors surface inline, partial Prometheus data lands in a `warnings[]` field, etc.).

The HTTP read surface is versioned and frozen at `/api/v1` (the bare `/api` prefix is a convenience alias the bundled SPA uses); the full contract and stability policy are in [`docs/api.md`](./docs/api.md).

Where this is headed: [`docs/roadmap.md`](./docs/roadmap.md) (v0.2 observability depth → v1.0 feature-complete read surface). The v0 build history is [`docs/plan.md`](./docs/plan.md).

## Quick start

### Run locally against a real BigFleet

```sh
make build                          # builds bin/bigfleet-web-dashboard with UI embedded
./bin/bigfleet-web-dashboard \
  --listen=:8080 \
  --prometheus-url=http://localhost:9090 \
  --coordinator-addr=localhost:7790 \
  --kubeconfig=$HOME/.kube/config
```

Open <http://localhost:8080>.

No live fleet handy? You can drive the Prometheus-backed views from a recorded
scale-test receipt (real data, not a fabricated demo) — see
[`docs/evaluating.md`](./docs/evaluating.md).

If the coordinator requires mTLS (ADR-0048), add the dashboard's readonly
certificate (it must carry the `bigfleet://readonly` URI SAN — ADR-0060):

```sh
  --tls-cert=/path/readonly.crt --tls-key=/path/readonly.key --tls-ca=/path/ca.crt
```

Omit all three to dial the coordinator in plaintext (the zero-config default).

### No Prometheus yet?

The dashboard is a Prometheus *client* — it does not scrape or store metrics
itself (that's a deliberate [anti-goal](./docs/roadmap.md#anti-goals-explicitly-not-on-the-roadmap):
the dashboard stays a thin client, not a metrics collector). For a small or
single-install deployment that doesn't already run Prometheus, run a *minimal*
Prometheus — itself one small static binary — scraping the shard and coordinator
`/metrics`, and point the dashboard at it:

```yaml
# prometheus.yml — minimal config for the dashboard's views
global:
  scrape_interval: 15s
scrape_configs:
  - job_name: bigfleet-shard       # exposes bigfleet_shard_* (cycle, inventory, actions, OCC)
    static_configs:
      - targets: ["bigfleet-shard-0:9090", "bigfleet-shard-1:9090"]
  - job_name: bigfleet-coordinator # exposes the coordinator raft/apply metrics
    static_configs:
      - targets: ["bigfleet-coordinator:9090"]
```

```sh
prometheus --config.file=prometheus.yml        # one static binary
./bin/bigfleet-web-dashboard --prometheus-url=http://localhost:9090 …
```

The coordinator (`/topology`, `/providers`, `/shard-reports`, `/needs`) and the
CRD views (`/clusters`, `/available-capacity`) don't need Prometheus at all —
they read the coordinator RPCs and the managed-cluster apiservers directly.

### Develop with hot-reload

```sh
make backend                        # binary without UI embedded (serves placeholder at /)
./bin/bigfleet-web-dashboard --listen=:8080 [...flags as above]

# in another terminal
make ui-dev                         # vite on :5173, proxies /api → :8080
```

Open <http://localhost:5173> — the Vite dev server hot-reloads on save.

### Run in a cluster (Helm)

After a tagged release, the chart is at `oci://ghcr.io/intunderflow/charts/bigfleet-web-dashboard`:

```sh
helm install bigfleet-web-dashboard oci://ghcr.io/intunderflow/charts/bigfleet-web-dashboard \
  --version 0.0.1 \
  --namespace bigfleet-system \
  --set prometheusUrl=http://prometheus:9090 \
  --set coordinatorAddr=bigfleet-coordinator.bigfleet-system:7790 \
  --set coordinatorTLS.secretName=bigfleet-web-dashboard-tls \
  --set kubeconfig.secretName=bigfleet-web-dashboard-kubeconfig \
  --set ingress.enabled=true \
  --set ingress.className=nginx \
  --set 'ingress.hosts[0].host=bigfleet.example.com' \
  --set 'ingress.hosts[0].paths[0].path=/'
```

### Behind a reverse-proxy path prefix

To serve the dashboard under a path prefix (e.g. `/fleet-dash/`) rather than at
a host root — say, aggregated alongside other dashboards behind one proxy — the
prefix must be **baked in at build time**. The SPA uses root-absolute asset and
API paths (`/assets/…`, `/api/…`), so a `<base href>` can't relocate it; instead
`BASE_PATH` flows into the Vite asset URLs, the router `basename`, and the API
fetch prefix (all via `import.meta.env.BASE_URL`). The prefix is the same for
every session, so this is built **once**, not per request:

```sh
docker build --build-arg BASE_PATH=/fleet-dash/ -t bigfleet-web-dashboard:fleet-dash .
```

This assumes a **prefix-stripping** proxy: the proxy forwards `/fleet-dash/…` to
the dashboard with the `/fleet-dash` prefix removed, so the server still sees
its own root-absolute `/assets/…` and `/api/…` paths. The default build
(`BASE_PATH=/`) serves standalone at root and is unchanged.

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│  bigfleet-web-dashboard (single Go binary)                   │
│  ┌────────────────────────┐   ┌──────────────────────┐   │
│  │  HTTP server + JSON API│ ← │  embedded React SPA  │   │
│  └─────┬──────┬──────┬────┘   └──────────────────────┘   │
│        │      │      │                                   │
│        ▼      ▼      ▼                                   │
│   prom ─┐  coord ─┐  k8s ─┐                              │
│   HTTP  │  gRPC   │  CRD  │                              │
│   API   │  admin  │  reads (multi-cluster, lazy)         │
└─────────┼─────────┼───────┼──────────────────────────────┘
          ▼         ▼       ▼
   Prometheus  Coordinator  Managed clusters' apiservers
```

Single-install scope: one Prometheus URL, one coordinator address, N managed-cluster kubeconfigs. Multi-tenant deployment is post-v0.

## Multi-cluster kubeconfig

The dashboard discovers managed clusters by enumerating contexts in the kubeconfig passed via `--kubeconfig`. **The context name is taken as the BigFleet `cluster_id`** — match what the operator was deployed with (the `--cluster-id=…` flag on `bigfleet-operator`).

A minimal kubeconfig for two managed clusters:

```yaml
apiVersion: v1
kind: Config
contexts:
- name: cluster-prod-eu-1            # ← used verbatim as cluster_id
  context: { cluster: prod-eu-1, user: bigfleet-web-dashboard }
- name: cluster-prod-us-1
  context: { cluster: prod-us-1, user: bigfleet-web-dashboard }
clusters:
- name: prod-eu-1
  cluster: { server: https://prod-eu-1.example.com }
- name: prod-us-1
  cluster: { server: https://prod-us-1.example.com }
users:
- name: bigfleet-web-dashboard
  user: { token: ... }
```

RBAC the dashboard needs in each managed cluster — a read-only `ClusterRole`
(`get`/`list`/`watch` on `capacityrequests`, `upcomingnodes`, and
`availablecapacities`, the CRDs it reads) plus a binding to the identity your
kubeconfig context authenticates as. Edit the binding subject in
`deploy/rbac/managed-cluster-reader.yaml`, then apply it to every kubeconfig
context with the helper:

```sh
deploy/rbac/apply-reader.sh [KUBECONFIG] [CONTEXT ...]   # defaults to all contexts
```

This is separate from the install chart: the dashboard reads managed clusters
over their apiservers (via `--kubeconfig`), not via its own in-cluster
ServiceAccount, which needs no RBAC where the dashboard runs.

### Authentication (optional)

The dashboard has no built-in auth — read-only is not the same as safe to
expose. Front it with the bundled **oauth2-proxy** sidecar: set
`--set auth.enabled=true`, point `auth.secretName` at a Secret holding the
`OAUTH2_PROXY_*` env, and pass your provider flags in `auth.extraArgs`. When
enabled, the Service targets the proxy, which authenticates and forwards to
the dashboard over loopback — so the dashboard can't be reached un-proxied.
(Or front it with your own ingress-level auth; the sidecar is opt-in.)

## Releasing

Tagged releases (`v*.*.*`) trigger `.github/workflows/release.yml`, which:

1. Builds the container image with `make` semantics and pushes to `ghcr.io/intunderflow/bigfleet-web-dashboard` tagged `vX.Y.Z`, `X.Y`, and `X`.
2. Packages the Helm chart with `version` and `appVersion` rewritten to match the tag and pushes to `oci://ghcr.io/intunderflow/charts/bigfleet-web-dashboard`.

The image build clones [`github.com/intUnderflow/bigfleet`](https://github.com/intUnderflow/bigfleet) so the `replace github.com/intUnderflow/bigfleet => ../bigfleet` directive in `go.mod` resolves at build time. For reproducible releases the revision is **pinned** in the [`BIGFLEET_REF`](./BIGFLEET_REF) file (a commit SHA); the release workflow reads it into `--build-arg BIGFLEET_REF`. Bump it deliberately in its own PR when the dashboard needs a newer bigfleet API. (CI still builds against bigfleet `main` so API drift surfaces early; only release images are pinned.) A local `make docker` defaults to `main` unless you pass `--build-arg BIGFLEET_REF=<sha>`.

Tag and push:

```sh
git tag v0.0.1
git push --tags
```

## Hard rules

- **Read-only.** The dashboard never mutates BigFleet state. Mutations (`AssignDomain`, etc.) stay in `bigfleetctl`.
- **Not load-bearing.** BigFleet's static-stability invariant means the dashboard can be down without anyone noticing operationally. Don't introduce any path where BigFleet depends on this dashboard.
- **No hand-copied proto / CRD code.** The coordinator gRPC client imports `github.com/intUnderflow/bigfleet` via `go.mod` (with `replace … => ../bigfleet` for local dev). Never copy generated code.
- **Cardinality discipline.** Pre-aggregate high-cardinality metrics (`bigfleet_shard_inventory_machines` has 9 × 4 × 28 = 1008 series per shard). Never `sum by (...)` over every label in a UI loop.

## Make targets

| Target | What it does |
|---|---|
| `make backend` | Build Go binary without UI embed |
| `make build` | Build single binary with UI embedded (`-tags embed_ui`) |
| `make ui-dev` | Vite dev server on :5173 with `/api` proxy |
| `make ui-build` | Build the SPA and copy it to `pkg/server/spa/` |
| `make test` | `go test -race ./...` |
| `make lint` | `go vet` + `tsc --noEmit` |
| `make docker` | Build the container image locally |
| `make helm-lint` | `helm lint` the chart |
| `make helm-template` | `helm template` the chart (smoke-render) |
| `make clean` | Remove `bin/`, `pkg/server/spa/`, `ui/dist`, `ui/node_modules` |

## License

MIT — see [`LICENSE`](LICENSE).
