package server

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"

	"github.com/intUnderflow/bigfleet-web-dashboard/pkg/coordclient"
	"github.com/intUnderflow/bigfleet-web-dashboard/pkg/shardclient"
)

// These benchmarks measure the dashboard's own per-request overhead — handler
// aggregation plus JSON encode, and the decode of the upstream payload — with
// the backing source stubbed to answer instantly. They deliberately exclude
// real Prometheus / coordinator / shard latency, which is those systems' SLO,
// not the dashboard's. See docs/slos.md; the numbers there come from here.

// benchServe drives one route through the mux with an in-memory recorder (no
// loopback socket), so the timing is the handler, not the network.
func benchServe(b *testing.B, s *Server, path string) {
	b.Helper()
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		rec := httptest.NewRecorder()
		s.mux.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			b.Fatalf("%s: status %d", path, rec.Code)
		}
	}
}

func benchServer(b *testing.B, promURL string) *Server {
	b.Helper()
	s, err := New(Config{Listen: ":0", PrometheusURL: promURL})
	if err != nil {
		b.Fatal(err)
	}
	return s
}

func makeNeedsSnapshot(n int) shardclient.NeedsSnapshot {
	needs := make([]shardclient.NeedView, n)
	for i := range needs {
		needs[i] = shardclient.NeedView{
			ClusterID:                 "cluster-" + strconv.Itoa(i%200),
			Priority:                  int32(i % 1000),
			AggregateResources:        map[string]string{"cpu": "32", "nvidia.com/gpu": "8"},
			MinUnit:                   map[string]string{"cpu": "8"},
			Group:                     "gang-" + strconv.Itoa(i%50),
			Requirements:              []string{"zone in (eu-west-1a)"},
			InterruptionPenaltyBucket: "$4",
			ReclamationPenaltyBucket:  "$2",
			Satisfied:                 i%3 == 0,
			ResidualDeficit:           map[string]string{"nvidia.com/gpu": "4"},
			ClaimedMachineCount:       int32(i % 64),
			SameDomain:                "rack-7",
			AgeCyclesUnmet:            int32(i % 20),
			UnmetReason:               "NO_MATCHING_SUPPLY",
		}
	}
	return shardclient.NeedsSnapshot{Cycle: 42, ComputedAtUnixNanos: 1780000000, TotalNeeds: n, Needs: needs}
}

// benchProm answers any instant query with a vector of podCount pod-labelled
// samples, so per-pod handlers (shards) build a row per series.
func benchProm(b *testing.B, podCount int) *httptest.Server {
	b.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"success","data":{"resultType":"vector","result":[`))
		for i := 0; i < podCount; i++ {
			if i > 0 {
				_, _ = w.Write([]byte(","))
			}
			fmt.Fprintf(w,
				`{"metric":{"pod":"bigfleet-shard-%d","state":"Configured","capacity_type":"Spot"},"value":[1780000000,"1"]}`,
				i)
		}
		_, _ = w.Write([]byte(`]}}`))
	}))
}

// BenchmarkNeeds — the needs explorer is the heaviest per-request transform
// (toAPINeedView over the whole snapshot). 2000 is the default limit; 20000 is
// a generous per-shard ceiling.
func BenchmarkNeeds(b *testing.B) {
	for _, n := range []int{2000, 20000} {
		b.Run(strconv.Itoa(n), func(b *testing.B) {
			s := benchServer(b, "")
			s.coord = &stubCoord{
				configured: true,
				shards:     []coordclient.ShardRegistryEntry{{ShardID: "shard-a", Address: "127.0.0.1:65535"}},
			}
			s.shardNeeds = &stubShardNeeds{snap: makeNeedsSnapshot(n)}
			benchServe(b, s, "/api/v1/needs?shard=shard-a")
		})
	}
}

// BenchmarkShards — fleet shard list. A single Raft group / single region tops
// out in the low tens of shards; 50 is a comfortable ceiling.
func BenchmarkShards(b *testing.B) {
	for _, n := range []int{10, 50} {
		b.Run(strconv.Itoa(n), func(b *testing.B) {
			prom := benchProm(b, n)
			defer prom.Close()
			s := benchServer(b, prom.URL)
			benchServe(b, s, "/api/v1/shards")
		})
	}
}
