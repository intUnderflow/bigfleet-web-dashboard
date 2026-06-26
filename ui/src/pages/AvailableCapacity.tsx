import { useQuery } from "@tanstack/react-query";
import { useConfig } from "../lib/useConfig";
import { api, type AvailableCapacityCluster } from "../lib/api";
import { formatInt } from "../lib/format";
import PageHeader from "../components/PageHeader";
import UnwiredNotice from "../components/UnwiredNotice";
import ErrorBox from "../components/ErrorBox";
import EmptyState from "../components/EmptyState";
import Card from "../components/Card";
import Badge, { type Tone } from "../components/Badge";

const availabilityTone: Record<string, Tone> = {
  High: "good",
  Medium: "info",
  Low: "warn",
  None: "neutral",
};

function resStr(m: Record<string, string> | undefined): string {
  if (!m) return "—";
  const parts = Object.entries(m).sort((a, b) => a[0].localeCompare(b[0]));
  return parts.length ? parts.map(([k, v]) => `${k}=${v}`).join(" ") : "—";
}

export default function AvailableCapacity() {
  const cfg = useConfig();
  const wired = cfg.data?.kubeconfigWired ?? false;

  const avc = useQuery({
    queryKey: ["available-capacity"],
    queryFn: api.availableCapacity,
    enabled: wired,
    refetchInterval: 30_000,
  });

  const clusters = avc.data?.clusters ?? [];
  const anyItems = clusters.some((c) => c.items.length > 0);

  return (
    <>
      <PageHeader
        title="Available capacity"
        subtitle="AvailableCapacity CRD hints — what each cluster's shard expects it could provision soon (eventually consistent; a hint, not a reservation)."
      />

      {!cfg.isLoading && !wired && <UnwiredNotice source="Kubeconfig" flag="--kubeconfig" />}

      {wired && avc.error && <ErrorBox error={avc.error as Error} />}

      {wired && !avc.error && avc.data && clusters.length === 0 && (
        <EmptyState title="No managed clusters">No contexts found in the kubeconfig.</EmptyState>
      )}

      {wired && !avc.error && avc.data && clusters.length > 0 && !anyItems && (
        <EmptyState title="No capacity hints yet">
          Shards emit AvailableCapacity as an eventually-consistent signal — hints appear once a shard has
          surplus it could offer.
        </EmptyState>
      )}

      {wired && !avc.error && (
        <div className="flex flex-col gap-4">
          {clusters
            .filter((c) => c.items.length > 0 || c.error)
            .map((c) => (
              <ClusterCard key={c.id} cluster={c} />
            ))}
        </div>
      )}
    </>
  );
}

function ClusterCard({ cluster }: { cluster: AvailableCapacityCluster }) {
  return (
    <Card
      title={<span className="font-mono">{cluster.id}</span>}
      subtitle={cluster.error ? undefined : `${cluster.items.length} hint(s)`}
    >
      {cluster.error ? (
        <Badge tone="danger" dot>
          {cluster.error}
        </Badge>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-[11px] uppercase tracking-wide text-[var(--text-subtle)]">
              <tr>
                <th className="py-1.5 text-left font-semibold">Name</th>
                <th className="py-1.5 text-left font-semibold">Resources</th>
                <th className="py-1.5 text-right font-semibold">Available</th>
                <th className="py-1.5 pl-4 text-left font-semibold">Availability</th>
                <th className="py-1.5 text-right font-semibold">Cost/hr</th>
              </tr>
            </thead>
            <tbody>
              {cluster.items.map((it) => (
                <tr key={it.name} className="border-t border-[var(--border)]">
                  <td className="py-1.5 font-mono text-xs text-[var(--text)]">{it.name}</td>
                  <td className="py-1.5 font-mono text-xs text-[var(--text-muted)]">{resStr(it.resources)}</td>
                  <td className="py-1.5 text-right tabular-nums">{formatInt(it.availableCount)}</td>
                  <td className="py-1.5 pl-4">
                    <Badge tone={availabilityTone[it.availability] ?? "neutral"}>{it.availability || "—"}</Badge>
                  </td>
                  <td className="py-1.5 text-right font-mono text-xs tabular-nums">{it.cost ? `$${it.cost}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
