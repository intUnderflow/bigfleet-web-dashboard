import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { formatInt } from "../lib/format";
import PageHeader from "../components/PageHeader";
import UnwiredNotice from "../components/UnwiredNotice";
import ErrorBox from "../components/ErrorBox";

export default function ClustersList() {
  const cfg = useQuery({ queryKey: ["config"], queryFn: api.config });
  const wired = cfg.data?.kubeconfigWired ?? false;

  const clusters = useQuery({
    queryKey: ["clusters"],
    queryFn: api.clusters,
    enabled: wired,
    refetchInterval: 20_000,
  });

  return (
    <>
      <PageHeader title="Clusters" subtitle="Per-cluster CapacityRequest and UpcomingNode state." />

      {!cfg.isLoading && !wired && <UnwiredNotice source="Kubeconfig" flag="--kubeconfig" />}

      {wired && clusters.error && (
        <div className="mt-6">
          <ErrorBox error={clusters.error as Error} />
        </div>
      )}

      {wired && !clusters.error && (
        <section className="mt-6 rounded-lg border border-neutral-200 dark:border-neutral-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 dark:bg-neutral-900/60 text-xs uppercase tracking-wide text-neutral-500">
              <tr>
                <th className="text-left font-medium px-4 py-2">Cluster</th>
                <th className="text-right font-medium px-4 py-2">CRs</th>
                <th className="text-right font-medium px-4 py-2">Pending</th>
                <th className="text-right font-medium px-4 py-2">UpcomingNodes</th>
                <th className="text-left font-medium px-4 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {clusters.isLoading && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-xs text-neutral-500">
                    Loading…
                  </td>
                </tr>
              )}
              {clusters.data && clusters.data.clusters.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-xs text-neutral-500">
                    No contexts found in the kubeconfig.
                  </td>
                </tr>
              )}
              {clusters.data?.clusters.map((c) => {
                const pendingTone =
                  c.capacityRequestsPending > 0
                    ? "text-amber-600 dark:text-amber-400 font-medium"
                    : "text-neutral-500";
                return (
                  <tr
                    key={c.id}
                    className="border-t border-neutral-200 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-900/60"
                  >
                    <td className="px-4 py-2 font-mono text-xs">
                      <Link
                        to={`/clusters/${encodeURIComponent(c.id)}`}
                        className="text-blue-600 hover:underline"
                      >
                        {c.id}
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {c.error ? "—" : formatInt(c.capacityRequests)}
                    </td>
                    <td className={`px-4 py-2 text-right tabular-nums ${pendingTone}`}>
                      {c.error ? "—" : formatInt(c.capacityRequestsPending)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {c.error ? "—" : formatInt(c.upcomingNodes)}
                    </td>
                    <td className="px-4 py-2 text-xs text-neutral-500">
                      {c.error ? <span className="text-red-600">{c.error}</span> : "ok"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}
