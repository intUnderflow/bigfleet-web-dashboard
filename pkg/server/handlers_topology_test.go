package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/intUnderflow/bigfleet-web-dashboard/pkg/api"
	"github.com/intUnderflow/bigfleet-web-dashboard/pkg/coordclient"
)

type stubCoord struct {
	configured bool
	shards     []coordclient.ShardRegistryEntry
	domains    []coordclient.DomainAssignment
	quotas     []coordclient.QuotaAllocation
	providers  []coordclient.Provider
	reports    []coordclient.ShardReport
	err        error
}

func (s *stubCoord) Configured() bool { return s.configured }
func (s *stubCoord) ListShards(_ context.Context) ([]coordclient.ShardRegistryEntry, error) {
	if s.err != nil {
		return nil, s.err
	}
	return s.shards, nil
}
func (s *stubCoord) ListDomainAssignments(_ context.Context) ([]coordclient.DomainAssignment, error) {
	if s.err != nil {
		return nil, s.err
	}
	return s.domains, nil
}
func (s *stubCoord) ListQuotas(_ context.Context) ([]coordclient.QuotaAllocation, error) {
	if s.err != nil {
		return nil, s.err
	}
	return s.quotas, nil
}
func (s *stubCoord) ListProviders(_ context.Context) ([]coordclient.Provider, error) {
	if s.err != nil {
		return nil, s.err
	}
	return s.providers, nil
}
func (s *stubCoord) ListShardReports(_ context.Context, _ string) ([]coordclient.ShardReport, error) {
	if s.err != nil {
		return nil, s.err
	}
	return s.reports, nil
}

func TestTopology_CoordUnwired(t *testing.T) {
	srv := newTestServerWith(t, "", &stubCoord{configured: false}, nil)
	defer srv.Close()
	res, err := http.Get(srv.URL + "/api/topology")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("status: want 503, got %d", res.StatusCode)
	}
}

func TestTopology_NotLeader(t *testing.T) {
	srv := newTestServerWith(t, "", &stubCoord{configured: true, err: coordclient.ErrNotLeader}, nil)
	defer srv.Close()
	res, err := http.Get(srv.URL + "/api/topology")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("status: want 503 (not leader), got %d", res.StatusCode)
	}
}

func TestTopology_HappyPath_NoProm(t *testing.T) {
	coord := &stubCoord{
		configured: true,
		shards: []coordclient.ShardRegistryEntry{
			{ShardID: "bigfleet-shard-0", Address: "bigfleet-shard-0:7780", RegisteredAtUnixNs: 1700000000_000_000_000, LastHeartbeatUnixNs: 1700000100_000_000_000},
			{ShardID: "bigfleet-shard-1", Address: "bigfleet-shard-1:7780", RegisteredAtUnixNs: 1700000010_000_000_000, LastHeartbeatUnixNs: 1700000110_000_000_000},
		},
		domains: []coordclient.DomainAssignment{
			{TopologyKey: "rack", TopologyValue: "r-1", ShardID: "bigfleet-shard-0"},
			{TopologyKey: "rack", TopologyValue: "r-2", ShardID: "bigfleet-shard-1"},
		},
		quotas: []coordclient.QuotaAllocation{
			{Provider: "aws", Region: "us-east-1", PerShard: map[string]int32{"bigfleet-shard-0": 500, "bigfleet-shard-1": 500}},
		},
	}
	srv := newTestServerWith(t, "", coord, nil)
	defer srv.Close()
	res, err := http.Get(srv.URL + "/api/topology")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status: want 200, got %d", res.StatusCode)
	}
	var got api.Topology
	if err := json.NewDecoder(res.Body).Decode(&got); err != nil {
		t.Fatal(err)
	}
	if len(got.Shards) != 2 || got.Shards[0].ShardID != "bigfleet-shard-0" {
		t.Errorf("shards: %v", got.Shards)
	}
	if got.Shards[0].RegisteredAtUnixSec != 1700000000 {
		t.Errorf("ns→sec conversion failed: got %d", got.Shards[0].RegisteredAtUnixSec)
	}
	if len(got.DomainAssignments) != 2 {
		t.Errorf("domains: %v", got.DomainAssignments)
	}
	if len(got.Quotas) != 1 || got.Quotas[0].PerShard["bigfleet-shard-0"] != 500 {
		t.Errorf("quotas: %v", got.Quotas)
	}
	if len(got.Warnings) == 0 {
		t.Error("expected a warning about prom not being configured")
	}
}

func TestTopology_WithProm(t *testing.T) {
	prom := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		q := r.Form.Get("query")
		w.Header().Set("Content-Type", "application/json")
		switch {
		case strings.Contains(q, "bigfleet_coordinator_raft_term"):
			writeVectorScalar(w, 7)
		case strings.Contains(q, `outcome="success"`):
			writeVectorScalar(w, 250.5)
		case strings.Contains(q, `outcome="error"`):
			writeVectorScalar(w, 0)
		case strings.Contains(q, "bigfleet_coordinator_pending_instructions"):
			writeVectorLabelled(w, "shard", map[string]float64{
				"bigfleet-shard-0": 2,
				"bigfleet-shard-1": 0,
			})
		default:
			w.WriteHeader(http.StatusInternalServerError)
		}
	}))
	defer prom.Close()

	coord := &stubCoord{
		configured: true,
		shards: []coordclient.ShardRegistryEntry{
			{ShardID: "bigfleet-shard-0"},
			{ShardID: "bigfleet-shard-1"},
		},
	}
	srv := newTestServerWith(t, prom.URL, coord, nil)
	defer srv.Close()

	res, err := http.Get(srv.URL + "/api/topology")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status: want 200, got %d", res.StatusCode)
	}
	var got api.Topology
	if err := json.NewDecoder(res.Body).Decode(&got); err != nil {
		t.Fatal(err)
	}
	if got.Coordinator.RaftTerm != 7 {
		t.Errorf("raft term: want 7, got %d", got.Coordinator.RaftTerm)
	}
	if got.Coordinator.ApplyRatePerSec != 250.5 {
		t.Errorf("apply rate: want 250.5, got %v", got.Coordinator.ApplyRatePerSec)
	}
	if got.Coordinator.PendingInstructionsTotal != 2 {
		t.Errorf("pending total: want 2, got %d", got.Coordinator.PendingInstructionsTotal)
	}
	if got.Shards[0].PendingInstructions != 2 || got.Shards[1].PendingInstructions != 0 {
		t.Errorf("per-shard pending wrong: %v", got.Shards)
	}
	if len(got.Warnings) != 0 {
		t.Errorf("unexpected warnings: %v", got.Warnings)
	}
}

func newTestServerWith(t *testing.T, promURL string, coord CoordReader, kube KubeReader) *httptest.Server {
	t.Helper()
	s, err := New(Config{Listen: ":0", PrometheusURL: promURL})
	if err != nil {
		t.Fatal(err)
	}
	if coord != nil {
		s.coord = coord
	}
	if kube != nil {
		s.kube = kube
	}
	return httptest.NewServer(s.mux)
}
