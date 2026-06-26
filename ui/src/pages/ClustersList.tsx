import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useConfig } from "../lib/useConfig";
import { api } from "../lib/api";
import { formatInt } from "../lib/format";
import PageHeader from "../components/PageHeader";
import UnwiredNotice from "../components/UnwiredNotice";
import ErrorBox from "../components/ErrorBox";
import Badge from "../components/Badge";
import { TableShell, THead, TH, TR, TD, MessageRow } from "../components/Table";

export default function ClustersList() {
  const cfg = useConfig();
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

      {wired && clusters.error && <ErrorBox error={clusters.error as Error} />}

      {wired && !clusters.error && (
        <TableShell>
          <THead>
            <tr>
              <TH>Cluster</TH>
              <TH right>CRs</TH>
              <TH right>Pending</TH>
              <TH right>UpcomingNodes</TH>
              <TH>Status</TH>
            </tr>
          </THead>
          <tbody>
            {clusters.isLoading && <MessageRow colSpan={5}>Loading…</MessageRow>}
            {clusters.data && clusters.data.clusters.length === 0 && (
              <MessageRow colSpan={5}>No contexts found in the kubeconfig.</MessageRow>
            )}
            {clusters.data?.clusters.map((c) => (
              <TR key={c.id} hover>
                <TD mono>
                  <Link
                    to={`/clusters/${encodeURIComponent(c.id)}`}
                    className="font-medium text-[var(--accent)] hover:underline"
                  >
                    {c.id}
                  </Link>
                </TD>
                <TD right muted={!!c.error}>{c.error ? "—" : formatInt(c.capacityRequests)}</TD>
                <TD
                  right
                  className={c.capacityRequestsPending > 0 ? "font-medium text-amber-600 dark:text-amber-400" : "text-[var(--text-muted)]"}
                >
                  {c.error ? "—" : formatInt(c.capacityRequestsPending)}
                </TD>
                <TD right muted={!!c.error}>{c.error ? "—" : formatInt(c.upcomingNodes)}</TD>
                <TD>
                  {c.error ? (
                    <Badge tone="danger" dot>
                      {c.error}
                    </Badge>
                  ) : (
                    <Badge tone="good" dot>
                      ok
                    </Badge>
                  )}
                </TD>
              </TR>
            ))}
          </tbody>
        </TableShell>
      )}
    </>
  );
}
