# Dashboard SLOs

What the dashboard promises about responsiveness, and how it's measured.

## The honest decomposition

End-to-end time for an operator to see a view is:

```
page latency  =  dashboard overhead  +  upstream query latency  +  browser render
```

Only the **first** and **last** terms are the dashboard's SLO. The middle term —
the time Prometheus takes to evaluate a query, the coordinator takes to answer a
read RPC, or a managed apiserver takes to list CRs — is governed by *those*
systems' SLOs. The dashboard reads **pre-aggregated** data (BigFleet aggregates
per topology domain / per penalty bucket / per shard before it ever reaches a
metric), so the dashboard's own work is small and bounded, and a slow page is
almost always an upstream-latency problem, not a dashboard problem.

This document states the dashboard-owned budgets and points at where to look
when the upstream term dominates.

## 1. Dashboard request overhead

The budget: the handler's own cost — aggregating the upstream payload and
encoding JSON — stays low and scales gently with fleet size.

Measured by `BenchmarkNeeds` / `BenchmarkShards`
([`pkg/server/handlers_bench_test.go`](../pkg/server/handlers_bench_test.go)),
which drive a route through the mux with an in-memory recorder and an
instant-answering stub upstream — so the number is pure dashboard overhead, no
network, no real Prometheus. On one M5 Max core:

| Endpoint | Fixture (cardinality) | Overhead / request | Allocs |
|---|---|---|---|
| `/api/v1/shards` | 10 shards | ≈ 0.30 ms | ≈ 2.5k |
| `/api/v1/shards` | 50 shards | ≈ 0.73 ms | ≈ 10k |
| `/api/v1/needs` | 2,000 needs (default limit) | ≈ 1.5 ms | ≈ 22k |
| `/api/v1/needs` | 20,000 needs (per-shard ceiling) | ≈ 14 ms | ≈ 220k |

The needs explorer is the heaviest transform (one `toAPINeedView` per Need over
the whole snapshot) and the only endpoint whose cost grows materially with
fleet size; it stays roughly linear (10× the rows → ~9× the time). Every other
endpoint consumes a bounded aggregate — finops is `capacity_type` (≤ ~6) ×
penalty bucket (powers of two, $0.50–$10M ≈ 25), clusters is the managed-cluster
count (~hundreds), the rest are O(1) — so all sit in the sub-millisecond-to-
few-millisecond band.

**SLO.** Dashboard overhead < **50 ms** per request at the documented scale
ceilings (single shard / single region; ≤ 50 shards; ≤ 20k needs per shard;
~200 managed clusters). A regression past that is a dashboard bug; the benchmark
is the gate.

## 2. Upstream wait is bounded, never unbounded

The dashboard never blocks an operator indefinitely on a slow source. Each
handler wraps its upstream calls in a context deadline (10 s for the
Prometheus range queries and the needs/shard reads; a tighter budget for the
per-cluster CRD lists). On deadline it returns `502` with the upstream error, or
— where a view is assembled from several sources — degrades: per-cluster errors
surface inline, partial Prometheus results land in a `warnings[]` field rather
than failing the whole page. An unwired source returns `503` immediately with
the flag to pass, never a hang.

These deadlines are a *safety bound*, not a target: if Prometheus regularly
needs ~10 s to answer, that is a Prometheus capacity issue to fix upstream — the
dashboard surfaces it (the `queriedAt` staleness banner, the `warnings[]`
field), it does not paper over it.

## 3. Browser render budget

Render stays bounded regardless of fleet size:

- Tables that can grow with the fleet (needs, scale-ceiling lists) virtualize
  above 150 rows (`@tanstack/react-virtual`, v0.3), so the DOM holds a windowed
  slice, not 20k rows — scroll stays smooth and first paint is bounded.
- Time-series panels render with uPlot (canvas), which handles thousands of
  points per series without DOM cost.
- Polling intervals are deliberate (10–30 s) so a left-open tab doesn't hammer
  the upstream sources.

**SLO.** Interaction stays responsive (no multi-second main-thread stalls) at
the scale ceilings. The virtualization threshold is the mechanism; the page
tests assert the windowed path renders.

## Where to look when a page is slow

1. Check `queriedAt` / the staleness banner — if it's stale, the dashboard is
   waiting on (or failing against) an upstream source.
2. Check a `warnings[]` field on the response — partial upstream data.
3. Compare against the overhead budget above. If the dashboard's own benchmark
   is green but the page is slow, the cost is upstream (Prometheus query
   latency, coordinator RPC, kube list) — fix it there, not here.
