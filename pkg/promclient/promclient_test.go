package promclient

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// stubProm returns an httptest server that answers any instant query with a
// single-sample vector carrying the given value string (Prometheus encodes
// NaN/Inf as the strings "NaN"/"+Inf"/"-Inf"), or an empty vector when
// valueStr is "".
func stubProm(t *testing.T, valueStr string) *Client {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if valueStr == "" {
			_, _ = w.Write([]byte(`{"status":"success","data":{"resultType":"vector","result":[]}}`))
			return
		}
		_, _ = w.Write([]byte(`{"status":"success","data":{"resultType":"vector","result":[{"metric":{},"value":[0,"` + valueStr + `"]}]}}`))
	}))
	t.Cleanup(srv.Close)
	c, err := New(srv.URL)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	return c
}

// QueryScalar must never return a NaN/Inf — those break json.Encode and
// produce a 200 with a truncated body. histogram_quantile over empty
// buckets (cycle-p99 when a shard has run no cycles) is the live source.
func TestQueryScalar_NaNInfMappedToZero(t *testing.T) {
	ctx := context.Background()
	cases := []struct {
		name  string
		value string // "" => empty vector
		want  float64
	}{
		{"nan", "NaN", 0},
		{"posinf", "+Inf", 0},
		{"neginf", "-Inf", 0},
		{"empty_vector", "", 0},
		{"normal", "4.08", 4.08},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := stubProm(t, tc.value).QueryScalar(ctx, "irrelevant", time.Unix(0, 0))
			if err != nil {
				t.Fatalf("QueryScalar: %v", err)
			}
			if got != tc.want {
				t.Errorf("QueryScalar(%q) = %v; want %v", tc.value, got, tc.want)
			}
		})
	}
}

func TestQueryScalar_NotConfigured(t *testing.T) {
	c, err := New("")
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	if _, err := c.QueryScalar(context.Background(), "x", time.Unix(0, 0)); err != ErrNotConfigured {
		t.Errorf("QueryScalar on unconfigured client = %v; want ErrNotConfigured", err)
	}
}
