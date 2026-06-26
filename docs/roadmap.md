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

### v0.2 — Observability depth
- **Needs Explorer.** ✓ done (ADR-0061) — a `/needs` view over a new general-purpose shard-side
  `ShardRead.InspectNeeds` RPC: a shard's per-Need last-cycle verdict (satisfied vs unmet + a
  colour-coded reason). The deepest observability slice; shipped ahead of the rest of v0.2.
- **Shard-reports drilldown.** The Topology card exists; add a `/shard-reports` view (or expand the
  card) with per-shard zone breakdown and a shortfall list sortable by priority / penalty bucket /
  age, plus an explicit "follower / rebuilding after failover" state.
- **Grafana embed where it already wins.** For the timeseries panels the scaletest Grafana
  dashboard nails, embed via iframe behind `--grafana-url` rather than re-rendering in React.
- **`AvailableCapacity` view.** The one `bigfleet.lucy.sh` CRD no view reads yet — surface
  pre-provisioned available capacity per cluster.
- **Freshness banners.** Surface `received_at` staleness everywhere soft state is shown; banner when
  the coordinator is a follower or the snapshot is empty.

### v0.3 — Operational ergonomics
- **Auth posture.** Ship an optional `oauth2-proxy` sidecar example in the chart + a doc — a
  read-only dashboard still should not be open to the world.
- **Reader-RBAC bootstrap helper.** A small script to `kubectl apply` `deploy/rbac/managed-cluster-reader.yaml`
  across kubeconfig contexts.
- **Deep links + saved filters.** URL-encode the phase/topology filters so a view is shareable.
- **Scale-ceiling rendering.** Virtualised tables for the 20K-cluster / 200-shard ceilings; meet
  the `plan.md` render budgets (fleet <500ms cold / <100ms warm; drilldown <1s).

### v0.4 — Evidence + history
- **Reference-fleet demo mode.** Point the dashboard at the published scale-test receipts (the
  bigfleet site's Grafana-loadable bundles) so it renders a real fleet with no live BigFleet — a
  zero-setup demo.
- **Short-window history.** Extend the drilldowns with Prometheus range queries (cycle-p99 trend,
  action-rate trend) beyond the single sparkline already present.

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
