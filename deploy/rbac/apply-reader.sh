#!/usr/bin/env bash
# Apply the read-only reader RBAC (managed-cluster-reader.yaml) to every
# context in a kubeconfig — the per-managed-cluster RBAC the dashboard needs
# to read CapacityRequest / UpcomingNode / AvailableCapacity (roadmap v0.3).
#
# Edit the binding subject in managed-cluster-reader.yaml first so it matches
# the identity each kubeconfig context authenticates as.
#
# Usage: deploy/rbac/apply-reader.sh [KUBECONFIG] [CONTEXT ...]
#   KUBECONFIG defaults to $KUBECONFIG or ~/.kube/config.
#   With no contexts listed, applies to every context in the kubeconfig.
set -euo pipefail

kubeconfig="${1:-${KUBECONFIG:-$HOME/.kube/config}}"
shift || true
manifest="$(cd "$(dirname "$0")" && pwd)/managed-cluster-reader.yaml"

if [[ ! -f "$manifest" ]]; then
  echo "manifest not found: $manifest" >&2
  exit 1
fi

contexts=("$@")
if [[ ${#contexts[@]} -eq 0 ]]; then
  mapfile -t contexts < <(kubectl --kubeconfig="$kubeconfig" config get-contexts -o name)
fi
if [[ ${#contexts[@]} -eq 0 ]]; then
  echo "no contexts found in $kubeconfig" >&2
  exit 1
fi

for ctx in "${contexts[@]}"; do
  echo "==> applying reader RBAC to context: $ctx"
  kubectl --kubeconfig="$kubeconfig" --context="$ctx" apply -f "$manifest"
done
echo "done: applied to ${#contexts[@]} context(s)"
