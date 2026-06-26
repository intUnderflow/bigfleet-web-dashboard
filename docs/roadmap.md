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

### v1.0 — Feature-complete read surface
- **Real multi-cluster e2e.** Exercise every view against the bigfleet repo's kind-based e2e harness
  (multi-cluster, real gRPC, real CRDs) — not just unit/stub tests.
- **Dashboard SLOs.** Document + measure the render budgets at the scale ceilings.
- **Endpoint smoke conformance.** A scripted check that every `/api/*` endpoint returns sane shapes
  against a known fixture.
- **Versioned API contract.** Freeze `/api/v1` so external operator tooling can depend on it.

### Beyond v1 (demand-gated)
- **Write surface.** A *separate* binary + a *distinct* `bigfleet://dashboard-operator` identity +
  an explicit confirmation flow — only if there is real demand. Mutations stay in `bigfleetctl` by
  default.
- **Multi-install / multi-tenant picker.** One install per instance is the v0–v1 scope.
- **Alerting hand-off.** Deep links into Alertmanager / Grafana — never a re-implementation.
- **Cost-feed integration.** Reconcile declared penalties against actual cloud bills — only if asked.

## Anti-goals (explicitly NOT on the roadmap)

- Reimplementing Prometheus, Grafana, or a CRD controller. The dashboard is a *client*.
- A per-CR / per-pod lifecycle audit trail — BigFleet metrics deliberately drop per-CR action
  linkage for cardinality reasons. Wait for the core to grow a trace surface.
- Becoming load-bearing.
- Casual mutation buttons.

## How we work it

- One vertical slice at a time; green CI (build · golangci-lint · race tests · eslint · vitest ·
  helm lint) before starting the next.
- Tag `v0.x` when a slice is green and e2e-verified; the release workflow pins `BIGFLEET_REF` per tag.
- Keep `plan.md` as the v0 archive; this file is the living target.
