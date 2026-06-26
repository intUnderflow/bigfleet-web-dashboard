package server

import (
	"encoding/json"
	"errors"
	"net/http"
	"testing"

	"github.com/intUnderflow/bigfleet-web-dashboard/pkg/api"
	"github.com/intUnderflow/bigfleet-web-dashboard/pkg/kubeclient"
)

func TestAvailableCapacity_KubeUnwired(t *testing.T) {
	srv := newTestServerWithKube(t, &stubKube{configured: false})
	defer srv.Close()
	res, err := http.Get(srv.URL + "/api/available-capacity")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("status = %d; want 503", res.StatusCode)
	}
}

func TestAvailableCapacity_HappyWithPerClusterErrorIsolation(t *testing.T) {
	kube := &stubKube{
		configured: true,
		clusters:   []string{"c1", "c2"},
		avc: map[string][]kubeclient.AvailableCapacity{
			"c1": {{Name: "a3-spot", AvailableCount: 12, Availability: "High", Cost: "6.50", Resources: map[string]string{"nvidia.com/gpu": "8"}}},
		},
		listErr: map[string]error{"c2": errors.New("apiserver down")},
	}
	srv := newTestServerWithKube(t, kube)
	defer srv.Close()

	res, err := http.Get(srv.URL + "/api/available-capacity")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status = %d; want 200", res.StatusCode)
	}
	var got api.AvailableCapacityResponse
	if err := json.NewDecoder(res.Body).Decode(&got); err != nil {
		t.Fatal(err)
	}
	if len(got.Clusters) != 2 {
		t.Fatalf("clusters = %d, want 2", len(got.Clusters))
	}
	byID := map[string]api.AvailableCapacityCluster{}
	for _, c := range got.Clusters {
		byID[c.ID] = c
	}
	c1 := byID["c1"]
	if c1.Error != nil || len(c1.Items) != 1 {
		t.Fatalf("c1 wrong: err=%v items=%d", c1.Error, len(c1.Items))
	}
	if c1.Items[0].Name != "a3-spot" || c1.Items[0].AvailableCount != 12 || c1.Items[0].Availability != "High" {
		t.Errorf("c1 item wrong: %+v", c1.Items[0])
	}
	if c2 := byID["c2"]; c2.Error == nil {
		t.Errorf("c2 should carry an inline error, got none")
	}
}
