package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/intUnderflow/bigfleet-web-dashboard/pkg/api"
)

func TestFinOps_PrometheusUnwired(t *testing.T) {
	srv := newTestServer(t, "")
	defer srv.Close()
	res, err := http.Get(srv.URL + "/api/finops/snapshot")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("status: want 503, got %d", res.StatusCode)
	}
}

func TestFinOps_HappyPath_RedFlag(t *testing.T) {
	prom := finopsStubPrometheus(t, finopsStubData{
		configuredByCap: map[string]float64{
			"Spot":      57, // 50 @ 0.5 + 7 @ pinned
			"OnDemand":  20,
			"Reserved":  10,
			"BareMetal": 5,
		},
		idleByCap: map[string]float64{
			"Spot":     30,
			"OnDemand": 5,
		},
		configuredMatrix: map[[2]string]float64{
			{"Spot", "0.5"}:       50,
			{"Spot", "pinned"}:    7,
			{"OnDemand", "8192"}:  20,
			{"Reserved", "65536"}: 10,
			{"BareMetal", "1024"}: 5,
		},
		configuredByBucket: map[string]float64{
			"0.5":    50,
			"pinned": 7,
			"8192":   20,
			"65536":  10,
			"1024":   5,
		},
		demandByBucket: map[string]float64{
			"pinned": 7,
			"0.5":    30,
			"8192":   25,
		},
		demandTotal: 62,
	})
	defer prom.Close()

	srv := newTestServer(t, prom.URL)
	defer srv.Close()

	res, err := http.Get(srv.URL + "/api/finops/snapshot")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status: want 200, got %d", res.StatusCode)
	}
	var got api.FinOpsSnapshot
	if err := json.NewDecoder(res.Body).Decode(&got); err != nil {
		t.Fatal(err)
	}
	wantCT := []string{"BareMetal", "Reserved", "OnDemand", "Spot"}
	if !stringSliceEqual(got.CapacityTypes, wantCT) {
		t.Errorf("capacityTypes order: want %v, got %v", wantCT, got.CapacityTypes)
	}
	if got.Buckets[0] != "0.5" || got.Buckets[len(got.Buckets)-1] != "pinned" {
		t.Errorf("buckets order: want 0.5 first / pinned last, got %v", got.Buckets)
	}
	if got.Configured["Spot"]["pinned"] != 7 {
		t.Errorf("Spot/pinned count: want 7, got %v", got.Configured["Spot"]["pinned"])
	}
	if got.Totals.ConfiguredMachines != 92 {
		t.Errorf("configured total: want 92, got %d", got.Totals.ConfiguredMachines)
	}
	if got.Totals.IdleMachines != 35 {
		t.Errorf("idle total: want 35, got %d", got.Totals.IdleMachines)
	}
	if got.Totals.DemandMachines != 62 {
		t.Errorf("demand total: want 62, got %d", got.Totals.DemandMachines)
	}
	// Spot configured = 57 / 92 ≈ 0.619
	if got.Totals.SpotConfiguredFraction < 0.6 || got.Totals.SpotConfiguredFraction > 0.63 {
		t.Errorf("spot fraction: want ~0.619, got %v", got.Totals.SpotConfiguredFraction)
	}
	// Pinned configured = 7 / 92 ≈ 0.076
	if got.Totals.PinnedConfiguredFraction < 0.07 || got.Totals.PinnedConfiguredFraction > 0.08 {
		t.Errorf("pinned fraction: want ~0.076, got %v", got.Totals.PinnedConfiguredFraction)
	}
	if got.ConfiguredByCapacityType["Spot"] != 57 {
		t.Errorf("ConfiguredByCapacityType[Spot]: want 57, got %v", got.ConfiguredByCapacityType["Spot"])
	}
	if got.IdleByCapacityType["Spot"] != 30 {
		t.Errorf("IdleByCapacityType[Spot]: want 30, got %v", got.IdleByCapacityType["Spot"])
	}
	if len(got.RedFlags) != 1 {
		t.Fatalf("want 1 red flag, got %d", len(got.RedFlags))
	}
	flag := got.RedFlags[0]
	if flag.Severity != "danger" || flag.CapacityType != "Spot" || flag.Bucket != "pinned" || flag.Count != 7 {
		t.Errorf("red flag wrong: %+v", flag)
	}
}

func TestFinOps_NoRedFlagWhenSpotPinnedZero(t *testing.T) {
	prom := finopsStubPrometheus(t, finopsStubData{
		configuredByCap: map[string]float64{"Spot": 50, "OnDemand": 20},
		idleByCap:       map[string]float64{},
		configuredMatrix: map[[2]string]float64{
			{"Spot", "0.5"}:      50,
			{"OnDemand", "8192"}: 20,
		},
		configuredByBucket: map[string]float64{"0.5": 50, "8192": 20},
		demandByBucket:     map[string]float64{"0.5": 30},
		demandTotal:        30,
	})
	defer prom.Close()
	srv := newTestServer(t, prom.URL)
	defer srv.Close()
	res, err := http.Get(srv.URL + "/api/finops/snapshot")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var got api.FinOpsSnapshot
	if err := json.NewDecoder(res.Body).Decode(&got); err != nil {
		t.Fatal(err)
	}
	if len(got.RedFlags) != 0 {
		t.Errorf("expected no red flags, got %v", got.RedFlags)
	}
}

// finopsStubData captures the canned Prometheus responses for the six
// queries the FinOps snapshot handler runs.
type finopsStubData struct {
	configuredByCap    map[string]float64
	idleByCap          map[string]float64
	configuredMatrix   map[[2]string]float64
	configuredByBucket map[string]float64
	demandByBucket     map[string]float64
	demandTotal        float64
}

func finopsStubPrometheus(_ *testing.T, d finopsStubData) *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		q := r.Form.Get("query")
		w.Header().Set("Content-Type", "application/json")
		switch {
		// Order matters: more specific (with `bucket`) before the broader
		// `inventory_machines` matches.
		case strings.Contains(q, "interruption_penalty_bucket") && strings.Contains(q, "capacity_type") && strings.Contains(q, "inventory_machines"):
			writeVectorTwoLabels(w, "capacity_type", "interruption_penalty_bucket", d.configuredMatrix)
		case strings.Contains(q, "by (interruption_penalty_bucket)") && strings.Contains(q, "inventory_machines"):
			writeVectorLabelled(w, "interruption_penalty_bucket", d.configuredByBucket)
		case strings.Contains(q, `state="Configured"`) && strings.Contains(q, "inventory_machines"):
			writeVectorLabelled(w, "capacity_type", d.configuredByCap)
		case strings.Contains(q, `state="Idle"`) && strings.Contains(q, "inventory_machines"):
			writeVectorLabelled(w, "capacity_type", d.idleByCap)
		case strings.Contains(q, "by (interruption_penalty_bucket)") && strings.Contains(q, "demand_machines"):
			writeVectorLabelled(w, "interruption_penalty_bucket", d.demandByBucket)
		case strings.Contains(q, "sum(bigfleet_shard_demand_machines)"):
			writeVectorScalar(w, d.demandTotal)
		case strings.Contains(q, "bigfleet_shard_actions_total"):
			writeVectorLabelled(w, "kind", map[string]float64{
				"Bootstrap": 1.5,
				"Reclaim":   0.1,
			})
		default:
			w.WriteHeader(http.StatusInternalServerError)
			_, _ = w.Write([]byte(`{"status":"error","error":"unexpected: ` + q + `"}`))
		}
	}))
}

func writeVectorTwoLabels(w http.ResponseWriter, lk1, lk2 string, m map[[2]string]float64) {
	body := promResponse{Status: "success"}
	body.Data.ResultType = "vector"
	for k, v := range m {
		body.Data.Result = append(body.Data.Result, promSample{
			Metric: map[string]string{lk1: k[0], lk2: k[1]},
			Value:  [2]any{float64(0), strconv.FormatFloat(v, 'g', -1, 64)},
		})
	}
	_ = json.NewEncoder(w).Encode(body)
}

func stringSliceEqual(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
