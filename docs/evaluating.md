# Evaluating the dashboard without a live BigFleet

You can see most of the dashboard's surfaces without standing up a real fleet —
**by pointing it at real recorded data, not fabricated demo data.** This repo
deliberately ships **no "demo mode"** with hand-written fleet numbers: the whole
BigFleet pitch is real data + inspectable receipts, and faking a fleet cuts
against that (and would be version-coupled maintenance). So instead:

## Run against a recorded Prometheus snapshot

Every published scale-test run ships a full, Grafana-loadable **Prometheus
receipt** (a TSDB snapshot). Serve one locally and point the dashboard at it:

```sh
# 1. Run Prometheus over a downloaded receipt snapshot.
prometheus \
  --storage.tsdb.path=/path/to/receipt/snapshot \
  --web.listen-address=127.0.0.1:9090 \
  --storage.tsdb.retention.time=10y          # so the historical window isn't trimmed

# 2. Point the dashboard at it (no coordinator / kubeconfig needed).
./bin/bigfleet-web-dashboard --prometheus-url=http://127.0.0.1:9090
```

Open <http://localhost:8080>. Then set the time of any historical query to the
window the snapshot covers (the receipt's README records the run window).

## What lights up — and what doesn't

A Prometheus snapshot has the **metrics**, but not the coordinator's gRPC state,
the managed-cluster CRDs, or the shards' live needs. So:

| View | Populates from a snapshot? |
|---|---|
| Fleet overview | ✅ (Prometheus aggregates) |
| Shards | ✅ (Prometheus per-pod) |
| FinOps | ✅ (penalty-bucket × capacity-type metrics) |
| Topology | ⚠️ Raft/apply tiles only (the coordinator gRPC reads are unwired) |
| Shard reports / Providers | ❌ (coordinator read RPCs — no live coordinator) |
| Needs | ❌ (shard `InspectNeeds` — no live shard) |
| Clusters / Available capacity | ❌ (managed-cluster CRDs — no kubeconfig) |

That's the honest trade: real numbers for the Prometheus-backed views, and the
unwired indicators (which the dashboard surfaces by design) for the rest. To
exercise the coordinator / CRD / needs views with real data, run against a live
BigFleet (a `kind` dev cluster is enough — see the bigfleet repo's quickstart).
