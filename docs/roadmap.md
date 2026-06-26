# bigfleet-web-dashboard roadmap

Forward-looking companion to [`plan.md`](./plan.md) (the v0 build history, M0–M6) and
[`CLAUDE.md`](../CLAUDE.md). `plan.md` is *how we got the first version shipped*; this is *where
we go next*. Milestones are versioned (`v0.x` → `v1.0` → beyond) and each is a vertical slice —
Go endpoint + React page + tests, green CI before the next one starts.

## Where we are (June 2026)

- **v0 shipped** — six views (fleet / shards / clusters / topology / providers / finops), one Go
  binary + embedded React SPA, deployable via Helm. See `plan.md`.
- **v0.1 done** — adopted into the canonical repo + brought to a hardened baseline: ADR-0048 mTLS
  with a `bigfleet://readonly` cert, the ADR-0060 `ListProviders` / `ListShardReports` RPCs
  consumed, golangci-lint + eslint + vitest gates, reproducible release pin (`BIGFLEET_REF`),
  hardened Helm (read-only-rootfs, nonroot, reader RBAC), a NaN/Inf JSON fix, and a docs honesty
  pass. CI green.
- **v0.2 → v1.0 done** — observability depth (Needs Explorer, freshness banners, shard-reports +
  AvailableCapacity views, Grafana embed), operational ergonomics (deep-link saved filters,
  virtualised tables, optional oauth2-proxy auth + reader RBAC), evidence + history (snapshot
  evaluation, range-query trend charts), and the v1.0 read surface: a frozen `/api/v1` contract
  ([`api.md`](./api.md)), endpoint smoke conformance, documented SLOs ([`slos.md`](./slos.md)), and a
  substrate-gated multi-cluster e2e suite ([`e2e.md`](./e2e.md)). **The dashboard is feature-complete
  as a read surface.**

## Guiding principles (do not break)

- **Read-only.** Mutations stay in `bigfleetctl`. The coordinator client holds a `bigfleet://readonly`
  cert — read-only at the transport, not just by convention.
- **Not load-bearing.** BigFleet must run with the dashboard down or wrong. No hot-path dependency
  from BigFleet on the dashboard, ever (static stability).
- **No hand-copied proto/CRD code.** Consume `github.com/intUnderflow/bigfleet` via `go.mod`.
- **Aggregate before render.** No raw-cardinality queries in a UI loop.
- **Core changes are general-purpose.** Anything the dashboard needs from bigfleet lands as a
  general operator-tooling capability, not a dashboard-specific hook (ADR-0060 set the precedent).

## Milestones

### v0.1 — Adopt + harden ✓ done
The adoption + audit punch-list above.

### v0.2 — Observability depth ✓ done
- **Needs Explorer.** ✓ (ADR-0061) — a `/needs` view over a new general-purpose shard-side
  `ShardRead.InspectNeeds` RPC: a shard's per-Need last-cycle verdict (satisfied vs unmet + a
  colour-coded reason).
- **Freshness banners.** ✓ — a reusable `Freshness` component (received-at age + stale/empty states)
  on the shard-reports + needs surfaces.
- **Shard-reports drilldown.** ✓ — a `/shard-reports` view with per-shard zone breakdown, shortfalls
  sortable by priority / age / penalty bucket, and explicit rebuilding/follower banners.
- **`AvailableCapacity` view.** ✓ — `/available-capacity`, the third `bigfleet.lucy.sh` CRD, grouped
  by cluster with availability badges + cost.
- **Grafana embed where it already wins.** ✓ — `GrafanaPanel`/`GrafanaLink` iframe the scale
  dashboard's timeseries panels behind `--grafana-url`.

### v0.3 — Operational ergonomics ✓ done
- **Deep links + saved filters.** ✓ — a `useSearchParamState` hook; Needs (shard + cluster) and
  shard-reports (sort) filters live in the URL.
- **Scale-ceiling rendering.** ✓ — the Needs table virtualises above 150 rows (@tanstack/react-virtual).
- **Auth posture.** ✓ — an opt-in `oauth2-proxy` sidecar in the chart (Service fronts the proxy) + docs.
- **Reader-RBAC bootstrap helper.** ✓ — `deploy/rbac/apply-reader.sh` applies the reader role across
  kubeconfig contexts.

### v0.4 — Evidence + history
- **Evaluate against a recorded snapshot, NOT a fabricated demo.** A "demo mode" that ships
  hand-written fleet numbers was considered and **rejected** (author, 2026-06-26): the whole project
  pitch is *real data + receipts*, and fabricated fixtures cut against that and are version-coupled
  maintenance. The honest path is documented in `docs/evaluating.md`: run the dashboard against a
  recorded Prometheus snapshot of a published run — real data, no fabrication (only the
  Prometheus-backed views populate, since a snapshot has no coordinator / CRD / shard-needs state,
  and the doc says so).
- **Short-window history. ✓** The shard drilldown now carries two Prometheus range-query trend
  charts — cycle-p99 and action-rate-by-kind over the last hour — via `/api/shards/{pod}/trends`
  and a reusable `TimeSeriesChart` component (`done`).

### v1.0 — Feature-complete read surface ✓ done
- **Real multi-cluster e2e. ✓** `test/e2e/dashboard_e2e_test.go` (`make e2e`, build tag `e2e`) is the
  conformance test's live-fleet sibling: it builds the real `server` in-process against a running
  multi-cluster BigFleet (real Prometheus / coordinator gRPC / CRDs), discovers real shard/cluster
  IDs, and drives every `/api/v1` route. It is **substrate-gated** — excluded from default CI, skips
  without `DASHBOARD_E2E_*`, and is run devpod-side (not on the laptop) per the CLAUDE.md
  validation-ladder rule. Stand-up + env contract: [`docs/e2e.md`](./e2e.md) (`done`, scaffolded).
- **Dashboard SLOs. ✓** [`docs/slos.md`](./slos.md) decomposes page latency into dashboard overhead
  (the dashboard's SLO) vs upstream query latency (Prometheus/coordinator/kube SLOs), states the
  per-request overhead budget (< 50 ms at the scale ceilings) measured by `BenchmarkNeeds` /
  `BenchmarkShards`, the bounded-upstream-wait guarantee, and the render budget (virtualization >150
  rows) (`done`).
- **Endpoint smoke conformance. ✓** `TestAPIConformance` drives every route in the `apiHandlers()`
  table against a full-stub fixture and asserts each returns `200` + a JSON object, under both the
  `/api/v1` and `/api` mounts — so a new route without coverage, or a broken mount, fails the build
  (`done`).
- **Versioned API contract. ✓** Every endpoint is dual-mounted under `/api/v1` (the frozen external
  contract) and the bare `/api` (the SPA's convenience alias). The contract + stability policy are
  documented in [`docs/api.md`](./api.md) (`done`).

### Beyond v1 (demand-gated)
- **Write surface.** A *separate* binary + a *distinct* `bigfleet://dashboard-operator` identity +
  an explicit confirmation flow — only if there is real demand. Mutations stay in `bigfleetctl` by
  default.
- **Multi-install / multi-tenant picker.** One install per instance is the v0–v1 scope.
- **Alerting hand-off.** Deep links into Alertmanager / Grafana — never a re-implementation.
- **Cost-feed integration.** Reconcile declared penalties against actual cloud bills — only if asked.

## Anti-goals (explicitly NOT on the roadmap)

- Reimplementing Prometheus, Grafana, or a CRD controller. The dashboard is a *client*.
  - **Built-in metrics scraping / embedded TSDB — proposed and declined (2026-06-26).** A
    `--scrape-target` mode (self-scrape `/metrics` into an embedded `prometheus/tsdb` + answer the
    existing PromQL via `prometheus/promql`) was considered so small deploys could skip an external
    Prometheus. Declined: it makes the dashboard a metrics *collector*, not a client — the spirit of
    this anti-goal — and `prometheus/prometheus` is the heaviest dependency in the Go ecosystem
    (hundreds of transitive deps, a big binary, a constant security/upgrade treadmill) for a narrow
    benefit, since essentially every BigFleet deployment already runs Prometheus (the receipts /
    Grafana / scaletest story all assume it). A Prometheus-less deployment runs a *minimal*
    Prometheus — itself one small static binary — and points the dashboard at it (README).
- A per-CR / per-pod lifecycle audit trail — BigFleet metrics deliberately drop per-CR action
  linkage for cardinality reasons. Wait for the core to grow a trace surface.
- Becoming load-bearing.
- Casual mutation buttons.

## How we work it

- One vertical slice at a time; green CI (build · golangci-lint · race tests · eslint · vitest ·
  helm lint) before starting the next.
- Tag `v0.x` when a slice is green and e2e-verified; the release workflow pins `BIGFLEET_REF` per tag.
- Keep `plan.md` as the v0 archive; this file is the living target.
