# CLAUDE.md — working brief for bigfleet-web-dashboard

This file is the brief you read first when joining this repo. Sister repo: [`bigfleet`](../bigfleet) (the system itself). Most design context lives there.

## What this repo is

A web dashboard for BigFleet. Single Go binary, serves a JSON API + an embedded React SPA. Reads from three sources:

1. **Prometheus** — BigFleet binaries expose `/metrics` on `:8790` (coord), `:8780` (shard), `:8770` (operator), `:8080` (pod-controller). Battle-tested PromQL lives in `../bigfleet/test/scaletest/chart/dashboards/scaletest.json`.
2. **Coordinator gRPC read RPCs** at `:7790` — `ListShards`, `ListDomainAssignments`, `ListQuotas`, `ListProviders`, `ListShardReports`. Leader-only and read-only — safe to poll. Under ADR-0048 the coordinator may require mTLS; ADR-0060 added a `bigfleet://readonly` SAN role these read RPCs accept, so the dashboard presents a readonly client cert (`--tls-cert/--tls-key/--tls-ca`) and *physically cannot* mutate the fleet. No TLS flags = plaintext, for a zero-config coordinator.
3. **CRDs in managed clusters** — `CapacityRequest` and `UpcomingNode` under `bigfleet.lucy.sh/v1alpha1`, read via `--kubeconfig`. (`AvailableCapacity` exists in the API group but no view reads it yet.)

BigFleet itself explicitly non-goals a web UI; that's why this lives in its own repo.

## Sources of truth (in order)

1. **The main repo's papers** — `../bigfleet/docs/papers/bigfleet.md` and `../bigfleet/docs/papers/fleet-scale-kubernetes.md`. Read these before recommending a view that touches design.
2. **The main repo's CLAUDE.md and `docs/`** — for the system itself.
3. **`docs/plan.md`** in this repo — for the dashboard's roadmap.
4. **`../bigfleet/test/scaletest/chart/dashboards/scaletest.json`** — the existing Grafana dashboard. ~40 panels of battle-tested PromQL. Anything we render in bespoke React, we render *the same query* the scaletest harness uses.

## Hard rules

- **Read-only.** This dashboard never mutates BigFleet state. Mutations (`AssignDomain`, `UnassignDomain`, `RemoveShard`) stay in `bigfleetctl`. Under mTLS the coordinator client carries a `bigfleet://readonly` certificate (ADR-0060) — read-only at the *transport* layer, not just by convention. If a future view wants to write, it ships behind a separate binary and a *distinct* write identity (e.g. `bigfleet://dashboard-operator`) plus an explicit confirmation flow — not as a casual button.
- **Not load-bearing.** BigFleet must keep working if the dashboard is down or wrong. Static stability (the main repo's load-bearing safety property) is not negotiable. Don't introduce any hot-path dependency from BigFleet on this dashboard, ever.
- **No copying of generated code.** `pkg/coordclient` imports the coordinator proto + `grpcutil` from `github.com/intUnderflow/bigfleet` via `go.mod` (`replace ... => ../bigfleet` for local dev). `pkg/kubeclient` reads CRDs as `unstructured` against a hardcoded GVR — no CRD-type import — which sidesteps the copy problem entirely. If the proto changes, bump the dependency; never hand-copy.
- **Cardinality discipline.** `bigfleet_shard_inventory_machines` has 9 states × 4 capacity types × 28 penalty buckets = 1008 series per shard. UI queries must aggregate (`sum by (state)`, `sum by (capacity_type)`, …) — never request the raw matrix.
- **Single install per dashboard instance.** v0 scope is one BigFleet deployment per dashboard instance. Multi-tenant pickers are post-v0.
- **Grafana embed where it fits.** For timeseries-heavy panels the scaletest dashboard already nails, embed via iframe. Don't rebuild what's already correct.

## Common hallucinations — don't add these

- ❌ A "fleet view" mutation. Read-only.
- ❌ Per-CR audit trail / lifecycle timeline. Cardinality reasons; BigFleet metrics deliberately don't preserve per-CR action linkage. Deferred unless and until the main repo ships it.
- ❌ A custom Prometheus implementation. We're a *client* of Prometheus.
- ❌ A custom CRD or controller. We watch existing CRDs.
- ❌ Embedding coordinator state directly (Raft replica). We're a client.

## Repo navigation

| Path | What's there |
|---|---|
| `cmd/bigfleet-web-dashboard/` | The single binary's entrypoint |
| `pkg/server/` | HTTP server, routes, SPA embed |
| `pkg/promclient/` | Prometheus HTTP API wrapper + the common queries |
| `pkg/coordclient/` | Coordinator gRPC client (proto + grpcutil via go.mod replace) |
| `pkg/kubeclient/` | Multi-cluster CRD reads (client-go dynamic, RV=0 watch-cache) |
| `pkg/api/` | JSON API types shared with the frontend |
| `ui/` | Vite + React + TS + Tailwind + uPlot SPA |
| `deploy/helm/bigfleet-web-dashboard/` | Helm chart |
| `docs/plan.md` | Implementation plan for this repo |

## Working discipline

- **Mirror existing queries.** When adding a panel, copy the query from the scaletest Grafana dashboard verbatim (and credit it in a comment) unless you have a measured reason to deviate.
- **Two views, then loop.** Build a vertical slice — one Go endpoint + one React page — end to end before opening a second one. Don't build five half-finished pages.
- **TypeScript types match the Go types.** `ui/src/lib/api.ts` mirrors `pkg/api/types.go` field-for-field (camelCase json tags); keep them in sync by hand when you touch either. (There is no codegen.)
- **No emoji in code or commits.**
- **Default to no comments** in code — only when the *why* is non-obvious.

## When stuck

- The main repo's `docs/user-stories.md` is the canonical list of who-looks-at-what. Each view in this dashboard should map cleanly to one or more user-story sections.
- The main repo's `docs/scaling-guide.md` has the fleet sizes the dashboard must handle (up to 100M machines / 200 shards / 20K clusters). Design for that, even when local dev is tiny.
