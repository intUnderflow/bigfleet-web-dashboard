package server

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/intUnderflow/bigfleet-web-dashboard/pkg/api"
	"github.com/intUnderflow/bigfleet-web-dashboard/pkg/coordclient"
)

func TestProviders_CoordUnwired(t *testing.T) {
	srv := newTestServerWith(t, "", &stubCoord{configured: false}, nil)
	defer srv.Close()
	res, err := http.Get(srv.URL + "/api/providers")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("status = %d; want 503", res.StatusCode)
	}
}

func TestProviders_Happy(t *testing.T) {
	coord := &stubCoord{
		configured: true,
		providers: []coordclient.Provider{
			{Name: "aws", Address: "aws-provider:7800", Region: "us-east-1"},
			{Name: "hetzner", Address: "hetzner-provider:7800", Region: "eu-central"},
		},
	}
	srv := newTestServerWith(t, "", coord, nil)
	defer srv.Close()
	res, err := http.Get(srv.URL + "/api/providers")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status = %d; want 200", res.StatusCode)
	}
	var got api.ProvidersList
	if err := json.NewDecoder(res.Body).Decode(&got); err != nil {
		t.Fatal(err)
	}
	if len(got.Providers) != 2 || got.Providers[0].Name != "aws" || got.Providers[1].Region != "eu-central" {
		t.Fatalf("providers round-trip wrong: %+v", got.Providers)
	}
}

func TestShardReports_CoordNotLeader(t *testing.T) {
	srv := newTestServerWith(t, "", &stubCoord{configured: true, err: coordclient.ErrNotLeader}, nil)
	defer srv.Close()
	res, err := http.Get(srv.URL + "/api/shard-reports")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("status = %d; want 503 (not leader)", res.StatusCode)
	}
}

func TestShardReports_Happy(t *testing.T) {
	coord := &stubCoord{
		configured: true,
		reports: []coordclient.ShardReport{
			{
				ShardID:          "shard-a",
				Cycle:            42,
				ReceivedAtUnixNs: 1_700_000_000_000_000_000,
				Summary: &coordclient.ShardReportSummary{
					TotalMachines:      100,
					FreeMachines:       20,
					InstanceTypeCounts: map[string]int32{"m5.large": 60, "g4dn.xlarge": 40},
					ZoneCounts:         map[string]int32{"z1": 50, "z2": 50},
				},
				Shortfalls: []coordclient.ShardReportShortfall{
					{Priority: 1000, Deficit: map[string]string{"cpu": "8"}, AgeCycles: 3, PenaltyBucket: "PENALTY_BUCKET_1"},
				},
			},
		},
	}
	srv := newTestServerWith(t, "", coord, nil)
	defer srv.Close()
	res, err := http.Get(srv.URL + "/api/shard-reports")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status = %d; want 200", res.StatusCode)
	}
	var got api.ShardReportsList
	if err := json.NewDecoder(res.Body).Decode(&got); err != nil {
		t.Fatal(err)
	}
	if len(got.Reports) != 1 {
		t.Fatalf("want 1 report, got %d", len(got.Reports))
	}
	r := got.Reports[0]
	if r.ShardID != "shard-a" || r.Cycle != 42 {
		t.Errorf("report header wrong: %+v", r)
	}
	if r.Summary == nil || r.Summary.TotalMachines != 100 || r.Summary.FreeMachines != 20 {
		t.Errorf("summary wrong: %+v", r.Summary)
	}
	if r.Summary.InstanceTypeCounts["g4dn.xlarge"] != 40 {
		t.Errorf("instance type counts wrong: %+v", r.Summary.InstanceTypeCounts)
	}
	if len(r.Shortfalls) != 1 || r.Shortfalls[0].Priority != 1000 ||
		r.Shortfalls[0].Deficit["cpu"] != "8" || r.Shortfalls[0].PenaltyBucket != "PENALTY_BUCKET_1" {
		t.Errorf("shortfall wrong: %+v", r.Shortfalls)
	}
}
