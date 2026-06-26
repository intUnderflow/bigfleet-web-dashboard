# Multi-cluster e2e — driving the dashboard against a real fleet

`make e2e` runs [`test/e2e/dashboard_e2e_test.go`](../test/e2e/dashboard_e2e_test.go):
the conformance test's live-fleet sibling. It constructs the real dashboard
`server` in-process, wired to a **real, running multi-cluster BigFleet** — real
Prometheus, real coordinator gRPC, real CRDs across managed clusters — and
drives **every** `/api/v1` route (enumerated from `APIRoutePatterns()`, so it
can't fall out of step with the surface), discovering real shard pods, cluster
IDs, and a coordinator shard ID from the list endpoints to fill the
`{pod}`/`{id}`/`needs?shard=` routes.

It is the rung that catches what stub tests structurally can't: a metric that
was renamed in the engine, an RPC field that moved, a CRD that didn't apply, a
TLS/SAN misconfig (ADR-0048/0060). The stub suites prove the dashboard's own
logic; this proves the **contract** against the systems it actually reads.

## Why it's gated, and where it runs

This suite is behind the `e2e` build tag, so it is excluded from `go test ./...`
and from default CI, and it `t.Skip`s unless the `DASHBOARD_E2E_*` env points it
at a fleet. That is deliberate:

- It needs a multi-cluster fleet (several kind clusters + a coordinator + a
  shard + Prometheus). That's a devpod/substrate-sized job, not a unit test.
- **Do not run it on the dev laptop as a routine gate.** Per the BigFleet
  `CLAUDE.md` validation-ladder rule, the kind rung runs devpod-side; running it
  on the laptop burns the dev box for work the substrate does for free. Use it
  when standing up or changing the harness, or as a substrate brief step.

## Standing up the fleet

The reference way to get a multi-cluster fleet is the **bigfleet repo's** own
kind harness — `make e2e` there (`test/e2e/multicluster_*`, `-tags=e2e`)
provisions N kind clusters, installs the CRDs, and runs a shard against them. A
substrate brief that wants to exercise the dashboard end-to-end deploys that
fleet (coordinator + shard + a Prometheus scraping them, across the managed
clusters) and then points this suite at the resulting endpoints.

## Running it

Wire the env to the deployed fleet, then `make e2e`:

```sh
export DASHBOARD_E2E_PROM_URL=http://prometheus.bigfleet-e2e:9090
export DASHBOARD_E2E_COORD_ADDR=coordinator.bigfleet-e2e:7790
export DASHBOARD_E2E_KUBECONFIG=$HOME/.kube/e2e-merged    # contexts for the managed clusters
export DASHBOARD_E2E_GRAFANA_URL=http://grafana.bigfleet-e2e:3000   # optional

# If the coordinator runs with mTLS (ADR-0048), supply the dashboard's
# bigfleet://readonly client cert (ADR-0060):
export DASHBOARD_E2E_TLS_CERT=/etc/bigfleet/readonly/tls.crt
export DASHBOARD_E2E_TLS_KEY=/etc/bigfleet/readonly/tls.key
export DASHBOARD_E2E_TLS_CA=/etc/bigfleet/ca.crt

make e2e
```

Any source left unwired is tolerated: routes backed by it are skipped (they
return the documented `503`), and `{pod}`/`{id}`/`needs` routes are skipped when
discovery turns up no shard/cluster. A route that returns anything other than
`200` (with a non-empty JSON object) or a `503` is a failure.

## Env reference

| Var | Required | Meaning |
|---|---|---|
| `DASHBOARD_E2E_PROM_URL` | one of the three | Prometheus base URL (fleet/shards/finops/trends views). |
| `DASHBOARD_E2E_COORD_ADDR` | one of the three | Coordinator gRPC `host:port` (topology/providers/shard-reports/needs). |
| `DASHBOARD_E2E_KUBECONFIG` | one of the three | Kubeconfig with the managed-cluster contexts (clusters/available-capacity). |
| `DASHBOARD_E2E_GRAFANA_URL` | no | Grafana base URL surfaced in `/config`. |
| `DASHBOARD_E2E_TLS_CERT/KEY/CA` | iff coordinator mTLS | The `bigfleet://readonly` client identity (ADR-0060). |

With none of the first three set, the suite skips. With a subset set, it
exercises the wired views and skips the rest — a partial-fleet brief is valid.
