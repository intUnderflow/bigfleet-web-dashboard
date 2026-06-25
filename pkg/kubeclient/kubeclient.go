// Package kubeclient watches BigFleet CRDs across the managed clusters listed
// in a multi-context kubeconfig. By convention, the kubeconfig context name is
// taken as the cluster_id used elsewhere in BigFleet (see docs/plan.md).
package kubeclient

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"sync"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
)

var ErrNotConfigured = errors.New("kube client not configured: pass --kubeconfig")

var (
	CapacityRequestsGVR = schema.GroupVersionResource{Group: "bigfleet.lucy.sh", Version: "v1alpha1", Resource: "capacityrequests"}
	UpcomingNodesGVR    = schema.GroupVersionResource{Group: "bigfleet.lucy.sh", Version: "v1alpha1", Resource: "upcomingnodes"}
)

type Client struct {
	kubeconfig string
	configs    map[string]*rest.Config

	mu      sync.Mutex
	clients map[string]dynamic.Interface
}

func New(kubeconfigPath string) (*Client, error) {
	if kubeconfigPath == "" {
		return &Client{clients: map[string]dynamic.Interface{}}, nil
	}
	raw, err := clientcmd.LoadFromFile(kubeconfigPath)
	if err != nil {
		return nil, fmt.Errorf("load kubeconfig: %w", err)
	}
	configs := make(map[string]*rest.Config, len(raw.Contexts))
	for name := range raw.Contexts {
		cfg, err := clientcmd.NewNonInteractiveClientConfig(*raw, name, &clientcmd.ConfigOverrides{}, nil).ClientConfig()
		if err != nil {
			return nil, fmt.Errorf("build REST config for context %q: %w", name, err)
		}
		configs[name] = cfg
	}
	return &Client{
		kubeconfig: kubeconfigPath,
		configs:    configs,
		clients:    map[string]dynamic.Interface{},
	}, nil
}

func (c *Client) Configured() bool { return c.kubeconfig != "" }

func (c *Client) Kubeconfig() string { return c.kubeconfig }

func (c *Client) Clusters() []string {
	out := make([]string, 0, len(c.configs))
	for k := range c.configs {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

func (c *Client) CountCapacityRequestsByPhase(ctx context.Context, cluster string) (map[string]int, error) {
	return c.countByStatusPhase(ctx, cluster, CapacityRequestsGVR, "Pending")
}

func (c *Client) CountUpcomingNodesByPhase(ctx context.Context, cluster string) (map[string]int, error) {
	return c.countByStatusPhase(ctx, cluster, UpcomingNodesGVR, "Provisioning")
}

func (c *Client) countByStatusPhase(ctx context.Context, cluster string, gvr schema.GroupVersionResource, defaultPhase string) (map[string]int, error) {
	cl, err := c.clientFor(cluster)
	if err != nil {
		return nil, err
	}
	// ResourceVersion="0" reads from the apiserver's watch cache — fast and
	// eventually consistent, which is what a dashboard wants.
	list, err := cl.Resource(gvr).List(ctx, metav1.ListOptions{ResourceVersion: "0"})
	if err != nil {
		return nil, err
	}
	out := make(map[string]int)
	for i := range list.Items {
		phase, _, _ := unstructured.NestedString(list.Items[i].Object, "status", "phase")
		if phase == "" {
			phase = defaultPhase
		}
		out[phase]++
	}
	return out, nil
}

func (c *Client) clientFor(cluster string) (dynamic.Interface, error) {
	if !c.Configured() {
		return nil, ErrNotConfigured
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if cl, ok := c.clients[cluster]; ok {
		return cl, nil
	}
	cfg, ok := c.configs[cluster]
	if !ok {
		return nil, fmt.Errorf("unknown cluster %q", cluster)
	}
	cl, err := dynamic.NewForConfig(cfg)
	if err != nil {
		return nil, fmt.Errorf("build dynamic client for %q: %w", cluster, err)
	}
	c.clients[cluster] = cl
	return cl, nil
}
