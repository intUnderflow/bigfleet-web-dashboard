package server

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/intUnderflow/bigfleet-web-dashboard/pkg/api"
)

type stubKube struct {
	configured bool
	clusters   []string
	crs        map[string]map[string]int
	uns        map[string]map[string]int
	listErr    map[string]error
}

func (s *stubKube) Configured() bool   { return s.configured }
func (s *stubKube) Clusters() []string { return s.clusters }

func (s *stubKube) CountCapacityRequestsByPhase(_ context.Context, cluster string) (map[string]int, error) {
	if err, ok := s.listErr[cluster]; ok {
		return nil, err
	}
	return s.crs[cluster], nil
}

func (s *stubKube) CountUpcomingNodesByPhase(_ context.Context, cluster string) (map[string]int, error) {
	if err, ok := s.listErr[cluster]; ok {
		return nil, err
	}
	return s.uns[cluster], nil
}

func TestClustersList_KubeconfigUnwired(t *testing.T) {
	srv := newTestServerWithKube(t, &stubKube{configured: false})
	defer srv.Close()

	res, err := http.Get(srv.URL + "/api/clusters")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("status: want 503, got %d", res.StatusCode)
	}
}

func TestClustersList_HappyPath(t *testing.T) {
	kube := &stubKube{
		configured: true,
		clusters:   []string{"cluster-prod-eu-1", "cluster-prod-us-1"},
		crs: map[string]map[string]int{
			"cluster-prod-eu-1": {"Pending": 3, "Acknowledged": 100},
			"cluster-prod-us-1": {"Acknowledged": 50},
		},
		uns: map[string]map[string]int{
			"cluster-prod-eu-1": {"Ready": 12, "Provisioning": 2},
			"cluster-prod-us-1": {"Ready": 8},
		},
	}
	srv := newTestServerWithKube(t, kube)
	defer srv.Close()

	res, err := http.Get(srv.URL + "/api/clusters")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status: want 200, got %d", res.StatusCode)
	}
	var got api.ClustersList
	if err := json.NewDecoder(res.Body).Decode(&got); err != nil {
		t.Fatal(err)
	}
	if len(got.Clusters) != 2 {
		t.Fatalf("want 2 clusters, got %d", len(got.Clusters))
	}
	eu := got.Clusters[0]
	if eu.ID != "cluster-prod-eu-1" {
		t.Errorf("order: want eu first, got %v", got.Clusters)
	}
	if eu.CapacityRequests != 103 {
		t.Errorf("eu total CRs: want 103, got %d", eu.CapacityRequests)
	}
	if eu.CapacityRequestsPending != 3 {
		t.Errorf("eu pending CRs: want 3, got %d", eu.CapacityRequestsPending)
	}
	if eu.UpcomingNodes != 14 {
		t.Errorf("eu UpcomingNodes: want 14, got %d", eu.UpcomingNodes)
	}
	if eu.Error != nil {
		t.Errorf("eu error: want nil, got %v", *eu.Error)
	}
}

func TestClustersList_PerClusterErrorReported(t *testing.T) {
	kube := &stubKube{
		configured: true,
		clusters:   []string{"cluster-broken", "cluster-ok"},
		crs:        map[string]map[string]int{"cluster-ok": {"Pending": 1}},
		uns:        map[string]map[string]int{"cluster-ok": {"Ready": 1}},
		listErr:    map[string]error{"cluster-broken": errors.New("network unreachable")},
	}
	srv := newTestServerWithKube(t, kube)
	defer srv.Close()

	res, err := http.Get(srv.URL + "/api/clusters")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status: want 200, got %d", res.StatusCode)
	}
	var got api.ClustersList
	if err := json.NewDecoder(res.Body).Decode(&got); err != nil {
		t.Fatal(err)
	}
	var broken *api.ClusterSummary
	for i := range got.Clusters {
		if got.Clusters[i].ID == "cluster-broken" {
			broken = &got.Clusters[i]
		}
	}
	if broken == nil {
		t.Fatal("expected cluster-broken in response")
	}
	if broken.Error == nil || *broken.Error == "" {
		t.Errorf("expected non-empty error, got %v", broken.Error)
	}
}

func TestClusterDetail_UnknownCluster(t *testing.T) {
	kube := &stubKube{
		configured: true,
		clusters:   []string{"cluster-a"},
		crs:        map[string]map[string]int{"cluster-a": {"Pending": 1}},
		uns:        map[string]map[string]int{"cluster-a": {"Ready": 1}},
	}
	srv := newTestServerWithKube(t, kube)
	defer srv.Close()

	res, err := http.Get(srv.URL + "/api/clusters/cluster-b")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusNotFound {
		t.Errorf("status: want 404, got %d", res.StatusCode)
	}
}

func TestClusterDetail_HappyPath(t *testing.T) {
	kube := &stubKube{
		configured: true,
		clusters:   []string{"cluster-a"},
		crs:        map[string]map[string]int{"cluster-a": {"Pending": 3, "Acknowledged": 47}},
		uns:        map[string]map[string]int{"cluster-a": {"Provisioning": 2, "Ready": 8, "Drained": 1}},
	}
	srv := newTestServerWithKube(t, kube)
	defer srv.Close()

	res, err := http.Get(srv.URL + "/api/clusters/cluster-a")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status: want 200, got %d", res.StatusCode)
	}
	var got api.ClusterDetail
	if err := json.NewDecoder(res.Body).Decode(&got); err != nil {
		t.Fatal(err)
	}
	if got.CapacityRequestsTotal != 50 {
		t.Errorf("CR total: want 50, got %d", got.CapacityRequestsTotal)
	}
	if got.UpcomingNodesTotal != 11 {
		t.Errorf("UN total: want 11, got %d", got.UpcomingNodesTotal)
	}
	if got.CapacityRequestsByPhase["Pending"] != 3 {
		t.Errorf("Pending: want 3, got %d", got.CapacityRequestsByPhase["Pending"])
	}
}

func newTestServerWithKube(t *testing.T, kube KubeReader) *httptest.Server {
	t.Helper()
	s, err := New(Config{Listen: ":0"})
	if err != nil {
		t.Fatal(err)
	}
	s.kube = kube
	return httptest.NewServer(s.mux)
}
