import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api, type Topology as TopologyData, type TopologyDomainAssignment } from "../lib/api";
import { formatInt, formatRate, formatRelative } from "../lib/format";
import PageHeader from "../components/PageHeader";
import UnwiredNotice from "../components/UnwiredNotice";
import ErrorBox from "../components/ErrorBox";
import Tile from "../components/Tile";

export default function Topology() {
  const cfg = useQuery({ queryKey: ["config"], queryFn: api.config });
  const wired = cfg.data?.coordinatorWired ?? false;

  const topology = useQuery({
    queryKey: ["topology"],
    queryFn: api.topology,
    enabled: wired,
    refetchInterval: 15_000,
  });

  return (
    <>
      <PageHeader
        title="Topology"
        subtitle="Coordinator state: shard registry, domain assignments, quotas, Raft health."
      />

      {!cfg.isLoading && !wired && <UnwiredNotice source="Coordinator" flag="--coordinator-addr" />}

      {wired && topology.error && (
        <div className="mt-6">
          <ErrorBox error={topology.error as Error} />
        </div>
      )}

      {wired && !topology.error && topology.data && <Body data={topology.data} />}
      {wired && !topology.error && !topology.data && (
        <div className="mt-6 text-xs text-neutral-500">Loading…</div>
      )}
    </>
  );
}

function Body({ data }: { data: TopologyData }) {
  const applyTone =
    data.coordinator.applyErrorRatePerSec > 0.001
      ? "danger"
      : data.coordinator.applyErrorRatePerSec > 0
      ? "warn"
      : "neutral";

  return (
    <div className="mt-6 flex flex-col gap-6">
      {data.warnings && data.warnings.length > 0 && (
        <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700/50 p-3 text-xs text-amber-900 dark:text-amber-200">
          <div className="font-semibold">Warnings</div>
          <ul className="mt-1 list-disc list-inside space-y-0.5">
            {data.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile label="Raft term" value={formatInt(data.coordinator.raftTerm)} />
        <Tile label="Apply rate" value={formatRate(data.coordinator.applyRatePerSec)} />
        <Tile
          label="Apply errors"
          value={formatRate(data.coordinator.applyErrorRatePerSec)}
          tone={applyTone}
        />
        <Tile
          label="Pending instructions"
          value={formatInt(data.coordinator.pendingInstructionsTotal)}
        />
      </div>

      <ShardsCard data={data} />
      <DomainsCard assignments={data.domainAssignments} />
      <QuotasCard quotas={data.quotas} />
    </div>
  );
}

function ShardsCard({ data }: { data: TopologyData }) {
  const nowSec = Date.now() / 1000;
  return (
    <Card title="Shard registry" subtitle="Coordinator.ListShards · last_heartbeat ages computed client-side">
      {data.shards.length === 0 ? (
        <div className="text-xs text-neutral-500">No shards registered.</div>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="text-left font-medium py-2">Shard ID</th>
              <th className="text-left font-medium py-2">Address</th>
              <th className="text-right font-medium py-2">Last heartbeat</th>
              <th className="text-right font-medium py-2">Pending</th>
            </tr>
          </thead>
          <tbody>
            {data.shards.map((s) => {
              const age = nowSec - s.lastHeartbeatUnixSec;
              const heartbeatTone =
                age > 60 ? "text-red-600" : age > 30 ? "text-amber-600" : "text-neutral-500";
              const pendingTone = s.pendingInstructions > 0 ? "text-amber-600 font-medium" : "";
              return (
                <tr key={s.shardId} className="border-t border-neutral-100 dark:border-neutral-800">
                  <td className="py-2 font-mono text-xs">
                    <Link
                      to={`/shards/${encodeURIComponent(s.shardId)}`}
                      className="text-blue-600 hover:underline"
                    >
                      {s.shardId}
                    </Link>
                  </td>
                  <td className="py-2 font-mono text-xs text-neutral-500">{s.address || "—"}</td>
                  <td className={`py-2 text-right text-xs tabular-nums ${heartbeatTone}`}>
                    {formatRelative(s.lastHeartbeatUnixSec, nowSec)}
                  </td>
                  <td className={`py-2 text-right tabular-nums ${pendingTone}`}>
                    {formatInt(s.pendingInstructions)}
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

function DomainsCard({ assignments }: { assignments: TopologyDomainAssignment[] }) {
  const grouped = useMemo(() => {
    const out = new Map<string, TopologyDomainAssignment[]>();
    for (const a of assignments) {
      const arr = out.get(a.topologyKey) ?? [];
      arr.push(a);
      out.set(a.topologyKey, arr);
    }
    for (const arr of out.values()) {
      arr.sort((x, y) => x.topologyValue.localeCompare(y.topologyValue));
    }
    return [...out.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [assignments]);

  return (
    <Card title="Domain assignments" subtitle="Coordinator.ListDomainAssignments · grouped by topology key">
      {grouped.length === 0 ? (
        <div className="text-xs text-neutral-500">No domain assignments.</div>
      ) : (
        <div className="space-y-4">
          {grouped.map(([key, rows]) => (
            <div key={key}>
              <div className="text-xs font-semibold text-neutral-500 uppercase tracking-wide font-mono">
                {key}
              </div>
              <ul className="mt-1 grid grid-cols-1 md:grid-cols-2 gap-x-6 text-sm">
                {rows.map((r) => (
                  <li
                    key={`${r.topologyKey}=${r.topologyValue}`}
                    className="flex items-center justify-between border-b border-neutral-100 dark:border-neutral-800 py-1"
                  >
                    <span className="font-mono text-xs">{r.topologyValue}</span>
                    <Link
                      to={`/shards/${encodeURIComponent(r.shardId)}`}
                      className="font-mono text-xs text-blue-600 hover:underline"
                    >
                      {r.shardId}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function QuotasCard({ quotas }: { quotas: TopologyData["quotas"] }) {
  return (
    <Card title="Speculative quotas" subtitle="Coordinator.ListQuotas · provider × region → per-shard slice">
      {quotas.length === 0 ? (
        <div className="text-xs text-neutral-500">No quota allocations.</div>
      ) : (
        <div className="space-y-3">
          {quotas.map((q) => {
            const total = Object.values(q.perShard).reduce((s, v) => s + v, 0);
            return (
              <div key={`${q.provider}/${q.region}`} className="border border-neutral-100 dark:border-neutral-800 rounded-md p-3">
                <div className="flex items-baseline justify-between">
                  <div className="font-mono text-xs">
                    <span className="text-neutral-500">{q.provider}</span>
                    <span className="text-neutral-400"> / </span>
                    <span>{q.region}</span>
                  </div>
                  <div className="text-xs tabular-nums text-neutral-500">{formatInt(total)} total</div>
                </div>
                <ul className="mt-2 grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-1 text-xs">
                  {Object.entries(q.perShard)
                    .sort((a, b) => a[0].localeCompare(b[0]))
                    .map(([shard, slice]) => (
                      <li
                        key={shard}
                        className="flex items-center justify-between border-b border-neutral-100 dark:border-neutral-800 py-1"
                      >
                        <Link
                          to={`/shards/${encodeURIComponent(shard)}`}
                          className="font-mono text-blue-600 hover:underline"
                        >
                          {shard}
                        </Link>
                        <span className="tabular-nums">{formatInt(slice)}</span>
                      </li>
                    ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </Card>
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
        {subtitle && <p className="text-xs text-neutral-500 font-mono mt-0.5">{subtitle}</p>}
      </header>
      {children}
    </section>
  );
}
