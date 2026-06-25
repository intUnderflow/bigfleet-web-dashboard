import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, type ClusterDetail as ClusterDetailData } from "../lib/api";
import { formatInt } from "../lib/format";
import { colourFor, crPhaseColours, upcomingNodePhaseColours } from "../lib/colours";
import PageHeader from "../components/PageHeader";
import UnwiredNotice from "../components/UnwiredNotice";
import ErrorBox from "../components/ErrorBox";
import Tile from "../components/Tile";
import StackedBar from "../components/StackedBar";

export default function ClusterDetail() {
  const { id = "" } = useParams();
  const cfg = useQuery({ queryKey: ["config"], queryFn: api.config });
  const wired = cfg.data?.kubeconfigWired ?? false;

  const detail = useQuery({
    queryKey: ["cluster", id],
    queryFn: () => api.cluster(id),
    enabled: wired && id !== "",
    refetchInterval: 15_000,
  });

  return (
    <>
      <PageHeader
        title={
          <span className="font-mono text-base">
            <Link to="/clusters" className="text-neutral-500 hover:underline">clusters</Link>
            <span className="text-neutral-400"> / </span>
            <span>{id}</span>
          </span>
        }
        subtitle="CapacityRequest and UpcomingNode phase breakdown for this cluster."
      />

      {!cfg.isLoading && !wired && <UnwiredNotice source="Kubeconfig" flag="--kubeconfig" />}

      {wired && detail.error && (
        <div className="mt-6">
          <ErrorBox error={detail.error as Error} />
        </div>
      )}

      {wired && !detail.error && detail.data && <Detail data={detail.data} />}
      {wired && !detail.error && !detail.data && (
        <div className="mt-6 text-xs text-neutral-500">Loading…</div>
      )}
    </>
  );
}

function Detail({ data }: { data: ClusterDetailData }) {
  const crSegments = Object.entries(data.capacityRequestsByPhase ?? {}).map(([k, v], i) => ({
    label: k,
    value: v,
    colour: colourFor(crPhaseColours, k, i),
  }));
  const unSegments = Object.entries(data.upcomingNodesByPhase ?? {}).map(([k, v], i) => ({
    label: k,
    value: v,
    colour: colourFor(upcomingNodePhaseColours, k, i),
  }));

  const pendingCount = data.capacityRequestsByPhase?.Pending ?? 0;
  const failedCount = data.upcomingNodesByPhase?.Failed ?? 0;

  return (
    <div className="mt-6 flex flex-col gap-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile label="CapacityRequests" value={formatInt(data.capacityRequestsTotal)} />
        <Tile
          label="Pending CRs"
          value={formatInt(pendingCount)}
          tone={pendingCount > 0 ? "warn" : "neutral"}
        />
        <Tile label="UpcomingNodes" value={formatInt(data.upcomingNodesTotal)} />
        <Tile
          label="Failed nodes"
          value={formatInt(failedCount)}
          tone={failedCount > 0 ? "danger" : "neutral"}
        />
      </div>

      <Card
        title="CapacityRequests by phase"
        subtitle="bigfleet.lucy.sh/v1alpha1 · status.phase ∈ {Pending, Acknowledged}"
      >
        <StackedBar segments={crSegments} formatValue={(v) => formatInt(v)} />
      </Card>

      <Card
        title="UpcomingNodes by phase"
        subtitle="bigfleet.lucy.sh/v1alpha1 · status.phase ∈ {Provisioning, Launched, Registered, Ready, Draining, Drained, Failed}"
      >
        <StackedBar segments={unSegments} formatValue={(v) => formatInt(v)} />
      </Card>
    </div>
  );
}

function Card({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4">
      <header className="mb-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        {subtitle && (
          <p className="text-xs text-neutral-500 font-mono mt-0.5">{subtitle}</p>
        )}
      </header>
      {children}
    </section>
  );
}
