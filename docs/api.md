# Dashboard HTTP API — `/api/v1` (frozen at v1.0)

This is the read-only HTTP contract the dashboard binary serves. As of v1.0 it
is **versioned and frozen**: external operator tooling should depend on the
`/api/v1` prefix. The same handlers are also mounted under the bare `/api`
prefix — that is what the bundled SPA calls, and it is a convenience alias, not
a stability guarantee. Build new integrations against `/api/v1`.

The route table lives in one place — `apiHandlers()` in
[`pkg/server/routes.go`](../pkg/server/routes.go) — and `TestAPIConformance`
([`pkg/server/handlers_conformance_test.go`](../pkg/server/handlers_conformance_test.go))
drives **every** entry under **both** prefixes against a full-stub fixture, so a
route that is added without coverage, or a mount that breaks, fails the build.

## Conventions

- **Method:** all endpoints are `GET`. The dashboard is read-only by design
  (ADR-0060); there is no write surface and there are no other verbs.
- **Encoding:** responses are a single JSON object, `Content-Type:
  application/json`. Field names are `lowerCamelCase`. The Go response types are
  in [`pkg/api/types.go`](../pkg/api/types.go).
- **`503 Service Unavailable`** when the backing data source for a view is not
  wired (e.g. `/fleet/overview` with no `--prometheus-url`, `/topology` with no
  `--coordinator-addr`, `/clusters` with no `--kubeconfig`). The body is
  `{"error": "<which flag to pass>"}`. This is the documented, expected response
  for an unconfigured source — not a fault.
- **Errors** are `{"error": "<message>"}` with a `4xx`/`5xx` status: `400` for a
  bad parameter, `404` for an unknown cluster/shard, `502` for an upstream
  (coordinator / shard / Prometheus) failure.
- **`queriedAt`** (RFC3339, UTC) is stamped on most responses: the instant the
  dashboard assembled the answer. It is the freshness signal the SPA surfaces.

## Endpoints

| Method & path | Source | Response type | Notes |
|---|---|---|---|
| `GET /api/v1/health` | — | `HealthResponse` | Liveness; always `200`. |
| `GET /api/v1/config` | — | `ClientConfig` | Which sources are wired + the Grafana base URL. Drives the SPA's unwired notices. |
| `GET /api/v1/fleet/overview` | Prometheus | `FleetOverview` | Fleet-wide shard/cluster/machine counts, cycle p99, shortfalls. |
| `GET /api/v1/fleet/actions` | Prometheus (range) | `FleetActionsSeries` | Action-rate-by-kind time series. `?duration` (≤24h), `?step` (≤1h). |
| `GET /api/v1/shards` | Prometheus | `ShardsList` | Per-shard summary rows. |
| `GET /api/v1/shards/{pod}` | Prometheus | `ShardDetail` | One shard: cycle/phase p99, inventory by state & capacity type, action rates, OCC broker stats. |
| `GET /api/v1/shards/{pod}/trends` | Prometheus (range) | `ShardTrends` | Cycle-p99 and action-rate-by-kind trends. `?duration` (≤24h), `?step` (≤1h). |
| `GET /api/v1/clusters` | kube CRDs | `ClustersListResponse` | Per-managed-cluster CapacityRequest / UpcomingNode counts. |
| `GET /api/v1/clusters/{id}` | kube CRDs | `ClusterDetail` | One cluster, CR/UpcomingNode counts by phase. `404` if `{id}` is unknown. |
| `GET /api/v1/available-capacity` | kube CRDs | `AvailableCapacityResponse` | `AvailableCapacity` CR hints per cluster. |
| `GET /api/v1/topology` | coordinator | `Topology` | Coordinator health, shard registry, domain→shard assignments, quotas. |
| `GET /api/v1/providers` | coordinator | `ProvidersListResponse` | Registered out-of-tree `CapacityProvider` backends. |
| `GET /api/v1/shard-reports` | coordinator | `ShardReportsListResponse` | Last roll-up summary + shortfalls per shard. |
| `GET /api/v1/needs` | coordinator + shard | `NeedsResponse` | One shard's last-cycle per-Need verdicts (ADR-0061). **Required** `?shard=<id>`; optional `?cluster=<id>`, `?limit=<n>`. |
| `GET /api/v1/finops/snapshot` | Prometheus | `FinOpsSnapshot` | Penalty-bucket × capacity-type cost view + red flags. |

## Stability policy

- `/api/v1` is **additive-only** within v1: new endpoints and new response
  fields may be added; existing endpoints, field names, and types will not
  change meaning or be removed under this prefix. A breaking change would ship
  as `/api/v2`.
- The bare `/api` alias tracks the latest version and carries no such guarantee.
- The contract is enforced by `TestAPIConformance` (shape + both mounts) plus
  the per-handler tests (values).
