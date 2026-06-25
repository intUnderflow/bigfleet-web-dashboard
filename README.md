# bigfleet-web-dashboard

A web dashboard for [BigFleet](https://github.com/intUnderflow/bigfleet) — the fleet-level Kubernetes infrastructure autoscaler.

BigFleet itself ships no in-tree web UI ("`kubectl` + structured logs + Prometheus is the bar," per the main repo's `docs/plan.md` §0). This repo is the consumption layer on top of that contract: a single Go binary that reads BigFleet's Prometheus metrics, calls the coordinator's read-only admin RPCs, and queries the three `bigfleet.lucy.sh/v1alpha1` CRDs across managed clusters — and presents the result as five focused views.

## Status

v0 functional surface complete (M0–M5). All five views are wired against real data sources; release tooling lands in M6.

| View | Route | Backed by |
|---|---|---|
| Fleet overview | `/` | Prometheus aggregates |
| Shards | `/shards`, `/shards/:pod` | Prometheus per-pod |
| Clusters | `/clusters`, `/clusters/:id` | Managed-cluster apiservers via `--kubeconfig` |
| Topology | `/topology` | Coordinator gRPC (`ListShards` / `ListDomainAssignments` / `ListQuotas`) + Prometheus coordinator metrics |
| FinOps | `/finops` | Penalty-bucket × capacity-type heatmap (`docs/user-stories.md` red-flag query) |

Every endpoint returns 503 with an actionable message when its data source isn't wired; every endpoint degrades gracefully when wired-but-failing (per-cluster errors surface inline, partial Prometheus data lands in a `warnings[]` field, etc.).

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
  --set kubeconfig.secretName=bigfleet-web-dashboard-kubeconfig \
  --set ingress.enabled=true \
  --set ingress.className=nginx \
  --set 'ingress.hosts[0].host=bigfleet.example.com' \
  --set 'ingress.hosts[0].paths[0].path=/'
```

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

RBAC the dashboard needs in each managed cluster (apply per cluster):

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: bigfleet-web-dashboard-reader
rules:
- apiGroups: ["bigfleet.lucy.sh"]
  resources: ["capacityrequests", "upcomingnodes", "availablecapacities"]
  verbs: ["get", "list", "watch"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: bigfleet-web-dashboard-reader
subjects:
- kind: ServiceAccount
  name: bigfleet-web-dashboard
  namespace: bigfleet-system
roleRef:
  kind: ClusterRole
  name: bigfleet-web-dashboard-reader
  apiGroup: rbac.authorization.k8s.io
```

## Releasing

Tagged releases (`v*.*.*`) trigger `.github/workflows/release.yml`, which:

1. Builds the container image with `make` semantics and pushes to `ghcr.io/intunderflow/bigfleet-web-dashboard` tagged `vX.Y.Z`, `X.Y`, and `X`.
2. Packages the Helm chart with `version` and `appVersion` rewritten to match the tag and pushes to `oci://ghcr.io/intunderflow/charts/bigfleet-web-dashboard`.

The image build clones [`github.com/intUnderflow/bigfleet`](https://github.com/intUnderflow/bigfleet) at `main` so the `replace github.com/intUnderflow/bigfleet => ../bigfleet` directive in `go.mod` resolves identically in CI and dev. Override with `--build-arg BIGFLEET_REF=<tag-or-commit>` to pin against a specific bigfleet revision.

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
