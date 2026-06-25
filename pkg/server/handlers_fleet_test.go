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

func TestFleetOverview_PrometheusUnwired(t *testing.T) {
	srv := newTestServer(t, "")
	defer srv.Close()

	res, err := http.Get(srv.URL + "/api/fleet/overview")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("status: want 503, got %d", res.StatusCode)
	}
}

func TestFleetOverview_HappyPath(t *testing.T) {
	prom := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		q := r.Form.Get("query")
		w.Header().Set("Content-Type", "application/json")
		switch {
		case strings.Contains(q, "rate(bigfleet_shard_cycle_duration_seconds_count[2m])"):
			writeVectorScalar(w, 3)
		case strings.Contains(q, "bigfleet_shard_active_sessions"):
			writeVectorScalar(w, 17)
		case strings.Contains(q, "bigfleet_shard_shortfalls"):
			writeVectorScalar(w, 0)
		case strings.Contains(q, "bigfleet_shard_cycle_duration_seconds_bucket"):
			writeVectorScalar(w, 0.042)
		case strings.Contains(q, "bigfleet_shard_inventory_machines"):
			writeVectorLabelled(w, "state",
				map[string]float64{"Idle": 10, "Configured": 90, "Configuring": 2})
		default:
			w.WriteHeader(http.StatusInternalServerError)
			_, _ = w.Write([]byte(`{"status":"error","error":"unexpected query: ` + q + `"}`))
		}
	}))
	defer prom.Close()

	srv := newTestServer(t, prom.URL)
	defer srv.Close()

	res, err := http.Get(srv.URL + "/api/fleet/overview")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status: want 200, got %d", res.StatusCode)
	}
	var got api.FleetOverview
	if err := json.NewDecoder(res.Body).Decode(&got); err != nil {
		t.Fatal(err)
	}
	if got.Shards != 3 {
		t.Errorf("shards: want 3, got %d", got.Shards)
	}
	if got.Clusters != 17 {
		t.Errorf("clusters: want 17, got %d", got.Clusters)
	}
	if got.Shortfalls != 0 {
		t.Errorf("shortfalls: want 0, got %d", got.Shortfalls)
	}
	if got.Machines != 102 {
		t.Errorf("machines: want 102, got %d", got.Machines)
	}
	if got.MachinesByState["Idle"] != 10 || got.MachinesByState["Configured"] != 90 {
		t.Errorf("machinesByState: unexpected map %v", got.MachinesByState)
	}
	if got.CycleP99Seconds != 0.042 {
		t.Errorf("cycleP99Seconds: want 0.042, got %v", got.CycleP99Seconds)
	}
}

func newTestServer(t *testing.T, promURL string) *httptest.Server {
	t.Helper()
	s, err := New(Config{Listen: ":0", PrometheusURL: promURL})
	if err != nil {
		t.Fatal(err)
	}
	return httptest.NewServer(s.mux)
}

type promSample struct {
	Metric map[string]string `json:"metric"`
	Value  [2]any            `json:"value"`
}

type promResponse struct {
	Status string `json:"status"`
	Data   struct {
		ResultType string       `json:"resultType"`
		Result     []promSample `json:"result"`
	} `json:"data"`
}

func writeVectorScalar(w http.ResponseWriter, v float64) {
	body := promResponse{Status: "success"}
	body.Data.ResultType = "vector"
	body.Data.Result = []promSample{
		{Metric: map[string]string{}, Value: [2]any{float64(0), strconv.FormatFloat(v, 'g', -1, 64)}},
	}
	_ = json.NewEncoder(w).Encode(body)
}

func writeVectorLabelled(w http.ResponseWriter, label string, byLabel map[string]float64) {
	body := promResponse{Status: "success"}
	body.Data.ResultType = "vector"
	for k, v := range byLabel {
		body.Data.Result = append(body.Data.Result, promSample{
			Metric: map[string]string{label: k},
			Value:  [2]any{float64(0), strconv.FormatFloat(v, 'g', -1, 64)},
		})
	}
	_ = json.NewEncoder(w).Encode(body)
}
