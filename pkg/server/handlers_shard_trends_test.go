package server

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/intUnderflow/bigfleet-web-dashboard/pkg/api"
)

// promTime parses a query_range start/end param, which the Prometheus client
// may send as a unix-seconds float or an RFC3339 string.
func promTime(s string) float64 {
	if f, err := strconv.ParseFloat(s, 64); err == nil {
		return f
	}
	if tm, err := time.Parse(time.RFC3339Nano, s); err == nil {
		return float64(tm.UnixNano()) / 1e9
	}
	return 0
}

// trendsStubProm answers Prometheus query_range with a two-point matrix,
// labelled by pod for the cycle-p99 query and by kind for the actions query.
func trendsStubProm(t *testing.T) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		q := r.Form.Get("query")
		start := promTime(r.Form.Get("start"))
		step, _ := strconv.ParseFloat(r.Form.Get("step"), 64)
		w.Header().Set("Content-Type", "application/json")

		var metric, value string
		switch {
		case strings.Contains(q, "cycle_duration"):
			metric, value = `"pod":"bigfleet-shard-0"`, "3.1"
		case strings.Contains(q, "actions_total"):
			metric, value = `"kind":"Bootstrap"`, "1.2"
		default:
			_, _ = w.Write([]byte(`{"status":"success","data":{"resultType":"matrix","result":[]}}`))
			return
		}
		t0, t1 := int64(start), int64(start+step)
		body := fmt.Sprintf(
			`{"status":"success","data":{"resultType":"matrix","result":[{"metric":{%s},"values":[[%d,"%s"],[%d,"%s"]]}]}}`,
			metric, t0, value, t1, value)
		_, _ = w.Write([]byte(body))
	}))
}

func TestShardTrends_PromUnwired(t *testing.T) {
	srv := newTestServerWith(t, "", nil, nil)
	defer srv.Close()
	res, err := http.Get(srv.URL + "/api/shards/bigfleet-shard-0/trends")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("status = %d; want 503", res.StatusCode)
	}
}

func TestShardTrends_InvalidPod(t *testing.T) {
	prom := trendsStubProm(t)
	defer prom.Close()
	srv := newTestServerWith(t, prom.URL, nil, nil)
	defer srv.Close()
	res, err := http.Get(srv.URL + "/api/shards/BAD_POD!/trends")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d; want 400", res.StatusCode)
	}
}

func TestShardTrends_Happy(t *testing.T) {
	prom := trendsStubProm(t)
	defer prom.Close()
	srv := newTestServerWith(t, prom.URL, nil, nil)
	defer srv.Close()

	res, err := http.Get(srv.URL + "/api/shards/bigfleet-shard-0/trends?duration=2m&step=1m")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status = %d; want 200", res.StatusCode)
	}
	var got api.ShardTrends
	if err := json.NewDecoder(res.Body).Decode(&got); err != nil {
		t.Fatal(err)
	}
	if got.Pod != "bigfleet-shard-0" || len(got.Timestamps) == 0 {
		t.Fatalf("trends header wrong: %+v", got)
	}
	if len(got.CycleP99Seconds) == 0 || got.CycleP99Seconds[0] != 3.1 {
		t.Errorf("cycle p99 series wrong: %v", got.CycleP99Seconds)
	}
	if b := got.ActionRates["Bootstrap"]; len(b) == 0 || b[0] != 1.2 {
		t.Errorf("action-rate series wrong: %v", got.ActionRates)
	}
}
