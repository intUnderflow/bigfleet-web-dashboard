import { useQuery } from "@tanstack/react-query";
import { useConfig } from "../lib/useConfig";
import { api, type AvailableCapacityCluster } from "../lib/api";
import { formatInt } from "../lib/format";
import PageHeader from "../components/PageHeader";
import UnwiredNotice from "../components/UnwiredNotice";
import ErrorBox from "../components/ErrorBox";
import Card from "../components/Card";

const availabilityStyle: Record<string, string> = {
  High: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
  Medium: "bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300",
  Low: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  None: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400",
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

      {wired && avc.error && (
        <div className="mt-6">
          <ErrorBox error={avc.error as Error} />
        </div>
      )}

      {wired && !avc.error && avc.data && clusters.length === 0 && (
        <div className="mt-6 text-xs text-neutral-500">No managed clusters in the kubeconfig.</div>
      )}

      {wired && !avc.error && avc.data && clusters.length > 0 && !anyItems && (
        <div className="mt-6 text-xs text-neutral-500">
          No AvailableCapacity hints published yet — shards emit these as an eventually-consistent
          signal, so they appear once a shard has surplus it could offer.
        </div>
      )}

      {wired && !avc.error && (
        <div className="mt-6 flex flex-col gap-4">
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
    <Card title={cluster.id} subtitle={cluster.error ? undefined : `${cluster.items.length} hint(s)`}>
      {cluster.error ? (
        <div className="text-xs text-red-600">{cluster.error}</div>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="text-left font-medium py-1">Name</th>
              <th className="text-left font-medium py-1">Resources</th>
              <th className="text-right font-medium py-1">Available</th>
              <th className="text-left font-medium py-1 pl-4">Availability</th>
              <th className="text-right font-medium py-1">Cost/hr</th>
            </tr>
          </thead>
          <tbody>
            {cluster.items.map((it) => {
              const cls =
                availabilityStyle[it.availability] ??
                "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400";
              return (
                <tr key={it.name} className="border-t border-neutral-100 dark:border-neutral-800">
                  <td className="py-1 font-mono text-xs">{it.name}</td>
                  <td className="py-1 font-mono text-xs text-neutral-500">{resStr(it.resources)}</td>
                  <td className="py-1 text-right tabular-nums">{formatInt(it.availableCount)}</td>
                  <td className="py-1 pl-4">
                    <span className={`inline-block rounded px-1.5 py-0.5 text-xs ${cls}`}>
                      {it.availability || "—"}
                    </span>
                  </td>
                  <td className="py-1 text-right tabular-nums font-mono text-xs">
                    {it.cost ? `$${it.cost}` : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Card>
  );
}
