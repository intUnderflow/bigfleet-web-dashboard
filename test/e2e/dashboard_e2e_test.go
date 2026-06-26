//go:build e2e

// Package e2e drives the dashboard's whole /api/v1 surface in-process against a
// REAL, running multi-cluster BigFleet — real Prometheus, real coordinator
// gRPC, real CRDs across managed clusters. It is the conformance test's
// live-fleet sibling: same route-table enumeration, but the upstreams are real
// rather than stubbed, so it catches contract drift the stubs can't (a metric
// that was renamed, an RPC field that moved, a CRD that didn't apply).
//
// This suite is SUBSTRATE-GATED. It is behind the `e2e` build tag so it is
// excluded from `go test ./...` and from default CI, and it `t.Skip`s unless
// the DASHBOARD_E2E_* env vars point it at a fleet. Stand the fleet up with the
// bigfleet repo's kind-based e2e harness; do NOT run this on the dev laptop as
// a routine gate (CLAUDE.md validation-ladder rule — the kind rung runs on a
// devpod/substrate, not the laptop). See docs/e2e.md.
package e2e

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/intUnderflow/bigfleet/pkg/grpcutil"

	"github.com/intUnderflow/bigfleet-web-dashboard/pkg/api"
	"github.com/intUnderflow/bigfleet-web-dashboard/pkg/server"
)

// envConfig builds a server.Config from the harness-provided env, or skips the
// whole suite if nothing is wired.
func envConfig(t *testing.T) server.Config {
	t.Helper()
	cfg := server.Config{
		PrometheusURL:   os.Getenv("DASHBOARD_E2E_PROM_URL"),
		CoordinatorAddr: os.Getenv("DASHBOARD_E2E_COORD_ADDR"),
		Kubeconfig:      os.Getenv("DASHBOARD_E2E_KUBECONFIG"),
		GrafanaURL:      os.Getenv("DASHBOARD_E2E_GRAFANA_URL"),
	}
	// The coordinator requires the bigfleet://readonly client cert (ADR-0060)
	// whenever it's running with mTLS (ADR-0048).
	if cert := os.Getenv("DASHBOARD_E2E_TLS_CERT"); cert != "" {
		cfg.TLS = grpcutil.TLSConfig{
			CertFile: cert,
			KeyFile:  os.Getenv("DASHBOARD_E2E_TLS_KEY"),
			CAFile:   os.Getenv("DASHBOARD_E2E_TLS_CA"),
		}
	}
	if cfg.PrometheusURL == "" && cfg.CoordinatorAddr == "" && cfg.Kubeconfig == "" {
		t.Skip("DASHBOARD_E2E_* not set; this suite needs a running multi-cluster bigfleet (see docs/e2e.md)")
	}
	return cfg
}

// getJSON GETs a URL and returns its status plus the decoded top-level object
// (nil for a non-object body). Fails the test on a transport error or, for a
// 200, an undecodable body — those are real dashboard faults, not env gaps.
func getJSON(t *testing.T, url string) (int, map[string]json.RawMessage) {
	t.Helper()
	client := &http.Client{Timeout: 30 * time.Second}
	res, err := client.Get(url)
	if err != nil {
		t.Fatalf("GET %s: %v", url, err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return res.StatusCode, nil
	}
	if ct := res.Header.Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
		t.Fatalf("GET %s: content-type %q; want application/json", url, ct)
	}
	var body map[string]json.RawMessage
	if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
		t.Fatalf("GET %s: decode: %v", url, err)
	}
	return res.StatusCode, body
}

// discover pulls a real shard pod, cluster id, and coordinator shard id from
// the list endpoints, so the {pod}/{id}/needs routes can be driven with values
// that actually exist in the fleet. Any source that's unwired yields "".
func discover(t *testing.T, base string) (pod, clusterID, shardID string) {
	t.Helper()
	var sl api.ShardsList
	if tryFetch(t, base+"/api/v1/shards", &sl) && len(sl.Shards) > 0 {
		pod = sl.Shards[0].Pod
	}
	var cl api.ClustersList
	if tryFetch(t, base+"/api/v1/clusters", &cl) && len(cl.Clusters) > 0 {
		clusterID = cl.Clusters[0].ID
	}
	var top api.Topology
	if tryFetch(t, base+"/api/v1/topology", &top) && len(top.Shards) > 0 {
		shardID = top.Shards[0].ShardID
	}
	return pod, clusterID, shardID
}

// tryFetch GETs a URL, decoding a 200 body into `into` and reporting true; a
// non-200 (e.g. an unwired source's 503) reports false without failing.
func tryFetch(t *testing.T, url string, into any) bool {
	t.Helper()
	client := &http.Client{Timeout: 30 * time.Second}
	res, err := client.Get(url)
	if err != nil {
		t.Fatalf("GET %s: %v", url, err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return false
	}
	if err := json.NewDecoder(res.Body).Decode(into); err != nil {
		t.Fatalf("GET %s: decode: %v", url, err)
	}
	return true
}

func TestDashboardE2E(t *testing.T) {
	cfg := envConfig(t)
	s, err := server.New(cfg)
	if err != nil {
		t.Fatalf("server.New: %v", err)
	}
	srv := httptest.NewServer(s.Handler())
	defer srv.Close()

	pod, clusterID, shardID := discover(t, srv.URL)
	t.Logf("discovered pod=%q cluster=%q shard=%q", pod, clusterID, shardID)
	repl := strings.NewReplacer("{pod}", pod, "{id}", clusterID)

	for _, pattern := range s.APIRoutePatterns() {
		_, suffix, _ := strings.Cut(pattern, " ")
		t.Run(suffix, func(t *testing.T) {
			switch {
			case strings.Contains(suffix, "{pod}") && pod == "":
				t.Skip("no shard pod discovered (Prometheus unwired or no shards reporting)")
			case strings.Contains(suffix, "{id}") && clusterID == "":
				t.Skip("no cluster discovered (kube unwired or no managed clusters)")
			}
			path := repl.Replace(suffix)
			if suffix == "/needs" {
				if shardID == "" {
					t.Skip("no coordinator shard id discovered (coordinator unwired)")
				}
				path += "?shard=" + shardID
			}

			status, body := getJSON(t, srv.URL+"/api/v1"+path)
			switch status {
			case http.StatusOK:
				if len(body) == 0 {
					t.Fatalf("%s: 200 with empty JSON object", path)
				}
			case http.StatusServiceUnavailable:
				// A source intentionally left unwired in this env. Acceptable
				// for a partial harness; a full multi-source fleet wires all.
				t.Skipf("%s: source unwired in this env (503)", path)
			default:
				t.Fatalf("%s: status %d; want 200 (or 503 if its source is unwired)", path, status)
			}
		})
	}
}
