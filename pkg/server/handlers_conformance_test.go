package server

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/intUnderflow/bigfleet-web-dashboard/pkg/coordclient"
	"github.com/intUnderflow/bigfleet-web-dashboard/pkg/kubeclient"
)

// conformanceProm answers any Prometheus instant query with a single-sample
// vector and any range query with a two-point matrix, carrying a broad label
// set so every handler's group-by label is present. The numbers are arbitrary;
// this fixture proves shape, not arithmetic (per-handler tests cover values).
func conformanceProm(t *testing.T) *httptest.Server {
	t.Helper()
	const labels = `"pod":"bigfleet-shard-0","state":"Configured","capacity_type":"Spot",` +
		`"kind":"Bootstrap","phase":"assign","shard":"shard-a",` +
		`"interruption_penalty_bucket":"$4","le":"+Inf"`
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		w.Header().Set("Content-Type", "application/json")
		if strings.Contains(r.URL.Path, "query_range") {
			start := promTime(r.Form.Get("start"))
			step, _ := strconv.ParseFloat(r.Form.Get("step"), 64)
			if step <= 0 {
				step = 30
			}
			t0, t1 := int64(start), int64(start+step)
			fmt.Fprintf(w,
				`{"status":"success","data":{"resultType":"matrix","result":[{"metric":{%s},"values":[[%d,"1"],[%d,"1"]]}]}}`,
				labels, t0, t1)
			return
		}
		fmt.Fprintf(w,
			`{"status":"success","data":{"resultType":"vector","result":[{"metric":{%s},"value":[1780000000,"1"]}]}}`,
			labels)
	}))
}

// newConformanceServer wires a Server with every backend stubbed so all routes
// return data. Returns the Server (for its route table) and the test HTTP
// server fronting its mux.
func newConformanceServer(t *testing.T, promURL string) (*Server, *httptest.Server) {
	t.Helper()
	s, err := New(Config{Listen: ":0", PrometheusURL: promURL, GrafanaURL: "http://grafana"})
	if err != nil {
		t.Fatal(err)
	}
	s.coord = &stubCoord{
		configured: true,
		shards:     []coordclient.ShardRegistryEntry{{ShardID: "shard-a", Address: "127.0.0.1:65535"}},
	}
	s.kube = &stubKube{
		configured: true,
		clusters:   []string{"cluster-eu"},
		crs:        map[string]map[string]int{"cluster-eu": {"Pending": 1}},
		uns:        map[string]map[string]int{"cluster-eu": {"Ready": 2}},
		avc: map[string][]kubeclient.AvailableCapacity{
			"cluster-eu": {{Name: "a3-spot", AvailableCount: 4, Availability: "High", Cost: "6.50"}},
		},
	}
	s.shardNeeds = &stubShardNeeds{}
	return s, httptest.NewServer(s.mux)
}

// requestPath fills route params and appends required query strings so a
// pattern from apiHandlers can be hit as a concrete URL.
func requestPath(suffix string) string {
	p := strings.NewReplacer("{pod}", "bigfleet-shard-0", "{id}", "cluster-eu").Replace(suffix)
	if suffix == "/needs" {
		p += "?shard=shard-a"
	}
	return p
}

// TestAPIConformance drives every route in the v1 surface against a full-stub
// fixture and asserts each returns 200 with a JSON object — under both the
// frozen /api/v1 prefix and the bare /api alias. Adding a route without
// covering it here (or breaking either mount) fails the build.
func TestAPIConformance(t *testing.T) {
	prom := conformanceProm(t)
	defer prom.Close()
	s, srv := newConformanceServer(t, prom.URL)
	defer srv.Close()

	for pattern := range s.apiHandlers() {
		method, suffix, _ := strings.Cut(pattern, " ")
		if method != http.MethodGet {
			t.Fatalf("conformance only models GET; got %q", pattern)
		}
		path := requestPath(suffix)
		for _, prefix := range []string{"/api/v1", "/api"} {
			url := srv.URL + prefix + path
			t.Run(method+" "+prefix+suffix, func(t *testing.T) {
				res, err := http.Get(url)
				if err != nil {
					t.Fatal(err)
				}
				defer res.Body.Close()
				if res.StatusCode != http.StatusOK {
					t.Fatalf("%s: status = %d; want 200", url, res.StatusCode)
				}
				if ct := res.Header.Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
					t.Fatalf("%s: content-type = %q; want application/json", url, ct)
				}
				var body map[string]json.RawMessage
				if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
					t.Fatalf("%s: decode: %v", url, err)
				}
				if len(body) == 0 {
					t.Fatalf("%s: empty JSON object", url)
				}
			})
		}
	}
}
