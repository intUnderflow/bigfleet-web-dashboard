# bigfleet-web-dashboard implementation plan

Companion to [`README.md`](../README.md) and [`CLAUDE.md`](../CLAUDE.md). Lists the milestones for getting from "empty repo" to "useful day-2 surface for BigFleet operators."

## v0 goal

Five views, one binary, deployable via Helm against an existing BigFleet install.

| View | Backed by | Implementation order |
|---|---|---|
| Fleet overview | Prometheus aggregates | M1 |
| Shard drilldown | Prometheus by pod + (later) coord soft state | M2 |
| Cluster drilldown | Prometheus by cluster + CRD watch | M3 |
| Topology + coordinator | Coordinator gRPC `ListShards`/`ListDomainAssignments`/`ListQuotas` | M4 |
| FinOps | Penalty-bucket × capacity-type matrix | M5 |

Each milestone is a vertical slice: Go endpoint + React page + integration test, end-to-end before the next slice starts.

## Milestones

### M0 — Scaffold ✓ shipped
Repo, Go module, UI scaffold (Vite+React+TS+Tailwind+uPlot+TanStack Query), Makefile, Helm chart skeleton, CI workflow.

### M1 — Fleet overview ✓ shipped
- Backend: `GET /api/fleet/overview` returns shard count, cluster count, total machines by state, total shortfalls, cycle p99 worst-shard, action rates over 5m.
- Backend: `pkg/promclient` with the dozen-or-so common queries from `../bigfleet/test/scaletest/chart/dashboards/scaletest.json`.
- Frontend: route `/`, single page with five number tiles + a `bigfleet_shard_actions_total` rate sparkline (uPlot).
- Wire-through: a kind-based local stack (BigFleet all-in-one + prom) renders the page correctly with non-zero values.

### M2 — Shard drilldown ✓ shipped
- Backend: `GET /api/shards` (from PromQL `count by (pod) (bigfleet_shard_cycle_duration_seconds_count)` + heartbeat from `ListShards`).
- Backend: `GET /api/shards/{pod}` returns cycle p99 + phase decomp + inventory state mix + shortfalls + OCC conflict rate.
- Frontend: list + drilldown page with cycle p99 + per-phase sparkline + stacked-state gauge.

### M3 — Cluster drilldown ✓ shipped
- Backend: `GET /api/clusters` (from CRD informer state + PromQL `count by (cluster) (bigfleet_operator_rollup_duration_seconds_count)`).
- Backend: `GET /api/clusters/{id}` returns rollup p99, ack p99, reconnect rate, CRs by phase, UpcomingNodes by phase.
- Frontend: list + drilldown page with CR table (phase filter) + UpcomingNode table.

### M4 — Topology + coordinator ✓ shipped
- Backend: `pkg/coordclient` wraps `ListShards`/`ListDomainAssignments`/`ListQuotas`.
- Backend: `GET /api/topology` returns shard registry, domain→shard map, quota allocations, Raft term, pending instructions per shard.
- Frontend: route `/topology` with shard list, domain-shard map (simple tree), quota matrix.

### M5 — FinOps ✓ shipped
- Backend: `GET /api/finops/penalty-matrix` returns the `inventory_machines{capacity_type, interruption_penalty_bucket}` × `demand_machines{interruption_penalty_bucket}` matrix.
- Frontend: route `/finops` renders the matrix as a heatmap; red cell when "Pinned penalty on Spot" (the user-stories.md red flag).

### M6 — Deploy ✓ shipped
- Multi-stage `Dockerfile` (node UI builder + go builder + distroless static-debian12:nonroot). `BIGFLEET_REF` build arg pins the sister-repo clone so dev and CI resolve `replace ../bigfleet` identically.
- Helm chart: Deployment, Service, ServiceAccount, optional Ingress. ImagePullPolicy + readiness/liveness probes on `/api/health`. Optional kubeconfig Secret mount.
- `.github/workflows/release.yml` on `v*.*.*` tag: builds + pushes image to `ghcr.io/intunderflow/bigfleet-web-dashboard`, packages + pushes chart to `oci://ghcr.io/intunderflow/charts/bigfleet-web-dashboard`. Chart version pinned from the git tag.
- `make docker`, `make helm-lint`, `make helm-template` for local verification.
- Auth: out of v0 scope. Recommended posture is a reverse-proxy in front (oauth2-proxy or similar). Sidecar mTLS to the upstreams is a vNext.

## Out of v0

- **Per-CR / per-pod lifecycle audit trail.** Cardinality reasons; BigFleet metrics deliberately don't preserve per-CR action linkage. Wait for the main repo to grow a per-CR trace surface.
- **Mutations.** `AssignDomain` etc. stay in `bigfleetctl`. Read-only is a hard rule for v0.
- **Alerting / paging.** Out of scope; Grafana/Alertmanager owns this.
- **Cost-feed integration.** v0 surfaces dollars-per-machine that the cluster already declared (`interruptionPenalty`, etc.); pulling cloud bills is post-v0.
- **Multi-tenant pickers.** One BigFleet install per dashboard instance.

## Scale targets

Match BigFleet's deployment ceilings (`../bigfleet/docs/scaling-guide.md`):

- ≤200 shards
- ≤20,000 clusters watched (CRD informers don't all need to be hot simultaneously — lazy-load by drilldown)
- ≤100M machines surfaced via aggregate metrics (never via per-machine queries)

Render budgets:
- Fleet overview: <500ms cold, <100ms warm (cached PromQL)
- Drilldown: <1s for a single entity
- Topology view: streaming-friendly for 20K cluster lists (virtualised tables, not all-at-once)

## Hard rules

Repeated from `CLAUDE.md`:

- Read-only.
- Not load-bearing.
- Use main-repo proto and CRD types via `go.mod`; never hand-copy.
- Aggregate before rendering. No raw cardinality bombs.
