package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/intUnderflow/bigfleet-web-dashboard/pkg/api"
)

func TestShardsList_PrometheusUnwired(t *testing.T) {
	srv := newTestServer(t, "")
	defer srv.Close()

	res, err := http.Get(srv.URL + "/api/shards")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("status: want 503, got %d", res.StatusCode)
	}
}

func TestShardsList_HappyPath(t *testing.T) {
	prom := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		q := r.Form.Get("query")
		w.Header().Set("Content-Type", "application/json")
		switch {
		case strings.Contains(q, "bigfleet_shard_cycle_duration_seconds_bucket"):
			writeVectorLabelled(w, "pod", map[string]float64{
				"bigfleet-shard-0": 0.05,
				"bigfleet-shard-1": 0.08,
			})
		case strings.Contains(q, "bigfleet_shard_inventory_machines"):
			writeVectorLabelled(w, "pod", map[string]float64{
				"bigfleet-shard-0": 100,
				"bigfleet-shard-1": 200,
			})
		case strings.Contains(q, "bigfleet_shard_shortfalls"):
			writeVectorLabelled(w, "pod", map[string]float64{
				"bigfleet-shard-0": 0,
				"bigfleet-shard-1": 3,
			})
		case strings.Contains(q, "bigfleet_shard_active_sessions"):
			writeVectorLabelled(w, "pod", map[string]float64{
				"bigfleet-shard-0": 5,
				"bigfleet-shard-1": 7,
			})
		default:
			w.WriteHeader(http.StatusInternalServerError)
		}
	}))
	defer prom.Close()

	srv := newTestServer(t, prom.URL)
	defer srv.Close()

	res, err := http.Get(srv.URL + "/api/shards")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status: want 200, got %d", res.StatusCode)
	}

	var got api.ShardsList
	if err := json.NewDecoder(res.Body).Decode(&got); err != nil {
		t.Fatal(err)
	}
	if len(got.Shards) != 2 {
		t.Fatalf("want 2 shards, got %d", len(got.Shards))
	}
	if got.Shards[0].Pod != "bigfleet-shard-0" || got.Shards[1].Pod != "bigfleet-shard-1" {
		t.Errorf("pod ordering wrong: %v", got.Shards)
	}
	if got.Shards[1].Shortfalls != 3 {
		t.Errorf("shard-1 shortfalls: want 3, got %d", got.Shards[1].Shortfalls)
	}
}

func TestShardDetail_RejectsBadPodName(t *testing.T) {
	srv := newTestServer(t, "http://placeholder")
	defer srv.Close()

	cases := []string{
		"/api/shards/foo bar",
		"/api/shards/-leading",
		"/api/shards/A-uppercase",
	}
	for _, p := range cases {
		res, err := http.Get(srv.URL + p)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		if res.StatusCode != http.StatusBadRequest {
			t.Errorf("%s: want 400, got %d", p, res.StatusCode)
		}
	}
}
