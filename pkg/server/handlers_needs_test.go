package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/intUnderflow/bigfleet-web-dashboard/pkg/api"
	"github.com/intUnderflow/bigfleet-web-dashboard/pkg/coordclient"
	"github.com/intUnderflow/bigfleet-web-dashboard/pkg/shardclient"
)

type stubShardNeeds struct {
	snap shardclient.NeedsSnapshot
	err  error
}

func (s *stubShardNeeds) InspectNeeds(_ context.Context, _, _ string, _ int) (shardclient.NeedsSnapshot, error) {
	return s.snap, s.err
}

func newNeedsTestServer(t *testing.T, coord CoordReader, sn ShardNeedsReader) *httptest.Server {
	t.Helper()
	s, err := New(Config{Listen: ":0"})
	if err != nil {
		t.Fatal(err)
	}
	if coord != nil {
		s.coord = coord
	}
	if sn != nil {
		s.shardNeeds = sn
	}
	return httptest.NewServer(s.mux)
}

func TestNeeds_CoordUnwired(t *testing.T) {
	srv := newNeedsTestServer(t, &stubCoord{configured: false}, nil)
	defer srv.Close()
	res, err := http.Get(srv.URL + "/api/needs?shard=shard-a")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("status = %d; want 503", res.StatusCode)
	}
}

func TestNeeds_MissingShardParam(t *testing.T) {
	srv := newNeedsTestServer(t, &stubCoord{configured: true}, nil)
	defer srv.Close()
	res, err := http.Get(srv.URL + "/api/needs")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d; want 400 (shard required)", res.StatusCode)
	}
}

func TestNeeds_ShardNotFound(t *testing.T) {
	coord := &stubCoord{configured: true, shards: []coordclient.ShardRegistryEntry{{ShardID: "shard-a", Address: "shard-a:7780"}}}
	srv := newNeedsTestServer(t, coord, &stubShardNeeds{})
	defer srv.Close()
	res, err := http.Get(srv.URL + "/api/needs?shard=nope")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusNotFound {
		t.Fatalf("status = %d; want 404", res.StatusCode)
	}
}

func TestNeeds_Happy(t *testing.T) {
	coord := &stubCoord{configured: true, shards: []coordclient.ShardRegistryEntry{{ShardID: "shard-a", Address: "shard-a:7780"}}}
	sn := &stubShardNeeds{snap: shardclient.NeedsSnapshot{
		Cycle:               88,
		ComputedAtUnixNanos: 1_700_000_000_000_000_000,
		TotalNeeds:          2,
		Needs: []shardclient.NeedView{
			{ClusterID: "payments", Priority: 1_000_000, Satisfied: false, UnmetReason: "PRIORITY_STARVED", ResidualDeficit: map[string]string{"cpu": "8"}},
			{ClusterID: "payments", Priority: 1000, Satisfied: true},
		},
	}}
	srv := newNeedsTestServer(t, coord, sn)
	defer srv.Close()

	res, err := http.Get(srv.URL + "/api/needs?shard=shard-a&cluster=payments")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status = %d; want 200", res.StatusCode)
	}
	var got api.NeedsResponse
	if err := json.NewDecoder(res.Body).Decode(&got); err != nil {
		t.Fatal(err)
	}
	if got.ShardID != "shard-a" || got.Cycle != 88 || got.TotalNeeds != 2 {
		t.Fatalf("header wrong: %+v", got)
	}
	if len(got.Needs) != 2 {
		t.Fatalf("needs = %d, want 2", len(got.Needs))
	}
	if got.Needs[0].Satisfied || got.Needs[0].UnmetReason != "PRIORITY_STARVED" || got.Needs[0].ResidualDeficit["cpu"] != "8" {
		t.Errorf("first need wrong: %+v", got.Needs[0])
	}
	if !got.Needs[1].Satisfied {
		t.Errorf("second need should be satisfied: %+v", got.Needs[1])
	}
}

func TestNeeds_ShardDialError(t *testing.T) {
	coord := &stubCoord{configured: true, shards: []coordclient.ShardRegistryEntry{{ShardID: "shard-a", Address: "shard-a:7780"}}}
	sn := &stubShardNeeds{err: context.DeadlineExceeded}
	srv := newNeedsTestServer(t, coord, sn)
	defer srv.Close()
	res, err := http.Get(srv.URL + "/api/needs?shard=shard-a")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusBadGateway {
		t.Fatalf("status = %d; want 502 (shard unreachable)", res.StatusCode)
	}
}
