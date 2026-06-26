import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useConfig } from "../lib/useConfig";
import { useSearchParamState } from "../lib/useSearchParamState";
import { api, type NeedView } from "../lib/api";
import { formatInt } from "../lib/format";
import PageHeader from "../components/PageHeader";
import UnwiredNotice from "../components/UnwiredNotice";
import ErrorBox from "../components/ErrorBox";
import Freshness from "../components/Freshness";

function resStr(m: Record<string, string> | undefined): string {
  if (!m) return "—";
  const parts = Object.entries(m).sort((a, b) => a[0].localeCompare(b[0]));
  return parts.length ? parts.map(([k, v]) => `${k}=${v}`).join(" ") : "—";
}

const reasonStyle: Record<string, string> = {
  PRIORITY_STARVED: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  NO_MATCHING_SUPPLY: "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300",
  TOPOLOGY_UNSATISFIABLE: "bg-purple-100 text-purple-800 dark:bg-purple-950/40 dark:text-purple-300",
  PREEMPTION_EXHAUSTED: "bg-orange-100 text-orange-800 dark:bg-orange-950/40 dark:text-orange-300",
};

function StatusCell({ n }: { n: NeedView }) {
  if (n.satisfied) {
    return (
      <span className="inline-block rounded px-1.5 py-0.5 text-xs bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
        satisfied
      </span>
    );
  }
  const cls = reasonStyle[n.unmetReason] ?? "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300";
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-mono ${cls}`}>
      {n.unmetReason || "UNMET"}
    </span>
  );
}

export default function Needs() {
  const cfg = useConfig();
  const wired = cfg.data?.coordinatorWired ?? false;

  const [shard, setShard] = useSearchParamState("shard");
  const [filter, setFilter] = useSearchParamState("cluster");

  const topology = useQuery({
    queryKey: ["topology"],
    queryFn: api.topology,
    enabled: wired,
    refetchInterval: 30_000,
  });
  const shards = useMemo(() => topology.data?.shards ?? [], [topology.data]);

  // Default the shard selector to the first registered shard once known.
  useEffect(() => {
    const first = shards[0];
    if (!shard && first) setShard(first.shardId);
  }, [shard, shards, setShard]);

  const needs = useQuery({
    queryKey: ["needs", shard],
    queryFn: () => api.needs(shard),
    enabled: wired && shard !== "",
    refetchInterval: 15_000,
  });

  const rows = useMemo(() => {
    const all = needs.data?.needs ?? [];
    const f = filter.trim().toLowerCase();
    return f ? all.filter((n) => n.clusterId.toLowerCase().includes(f)) : all;
  }, [needs.data, filter]);

  return (
    <>
      <PageHeader
        title="Needs explorer"
        subtitle="A shard's per-Need last-cycle verdict (ShardRead.InspectNeeds): which needs are satisfied vs unmet, and why."
      />

      {!cfg.isLoading && !wired && <UnwiredNotice source="Coordinator" flag="--coordinator-addr" />}

      {wired && (
        <div className="mt-6 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs text-neutral-500">
            Shard
            <select
              value={shard}
              onChange={(e) => setShard(e.target.value)}
              className="rounded-md border border-neutral-300 dark:border-neutral-700 bg-transparent px-2 py-1 text-sm font-mono"
            >
              {shards.length === 0 && <option value="">no shards registered</option>}
              {shards.map((s) => (
                <option key={s.shardId} value={s.shardId}>
                  {s.shardId}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-neutral-500">
            Filter by cluster
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="substring…"
              className="rounded-md border border-neutral-300 dark:border-neutral-700 bg-transparent px-2 py-1 text-sm font-mono"
            />
          </label>
          {needs.data && (
            <div className="flex items-center gap-2 text-xs text-neutral-500">
              <Freshness
                unixNanos={needs.data.computedAtUnixNanos}
                cycle={needs.data.cycle}
                staleAfterSec={20}
                emptyLabel="rebuilding (no cycle yet)"
              />
              <span>
                · {formatInt(rows.length)}/{formatInt(needs.data.totalNeeds)} needs
              </span>
            </div>
          )}
        </div>
      )}

      {wired && needs.error && (
        <div className="mt-6">
          <ErrorBox error={needs.error as Error} />
        </div>
      )}

      {wired && !needs.error && (
        <section className="mt-4 rounded-lg border border-neutral-200 dark:border-neutral-800 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 dark:bg-neutral-900/60 text-xs uppercase tracking-wide text-neutral-500">
              <tr>
                <th className="text-left font-medium px-3 py-2">Cluster</th>
                <th className="text-right font-medium px-3 py-2">Prio</th>
                <th className="text-left font-medium px-3 py-2">Aggregate</th>
                <th className="text-left font-medium px-3 py-2">Min unit</th>
                <th className="text-left font-medium px-3 py-2">Int$/Rec$</th>
                <th className="text-left font-medium px-3 py-2">Status</th>
                <th className="text-left font-medium px-3 py-2">Deficit</th>
                <th className="text-right font-medium px-3 py-2">Claimed</th>
                <th className="text-left font-medium px-3 py-2">Notes</th>
              </tr>
            </thead>
            <tbody>
              {needs.isLoading && (
                <tr>
                  <td colSpan={9} className="px-3 py-6 text-center text-xs text-neutral-500">
                    Loading…
                  </td>
                </tr>
              )}
              {needs.data && rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-3 py-6 text-center text-xs text-neutral-500">
                    {needs.data.cycle === 0
                      ? "Shard is rebuilding its needs ledger (no cycle yet)."
                      : "No needs match."}
                  </td>
                </tr>
              )}
              {rows.map((n, i) => (
                <tr
                  key={`${n.clusterId}/${n.group}/${n.priority}/${i}`}
                  className="border-t border-neutral-100 dark:border-neutral-800 align-top"
                >
                  <td className="px-3 py-2 font-mono text-xs">{n.clusterId}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatInt(n.priority)}</td>
                  <td className="px-3 py-2 font-mono text-xs">{resStr(n.aggregateResources)}</td>
                  <td className="px-3 py-2 font-mono text-xs text-neutral-500">{resStr(n.minUnit)}</td>
                  <td className="px-3 py-2 font-mono text-xs text-neutral-500">
                    {n.interruptionPenaltyBucket}/{n.reclamationPenaltyBucket}
                  </td>
                  <td className="px-3 py-2">
                    <StatusCell n={n} />
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-amber-700 dark:text-amber-400">
                    {n.satisfied ? "—" : resStr(n.residualDeficit)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatInt(n.claimedMachineCount)}</td>
                  <td className="px-3 py-2 text-xs text-neutral-500">
                    {n.group && <span className="font-mono">gang {n.group} </span>}
                    {n.sameDomain && <span className="font-mono">@{n.sameDomain} </span>}
                    {n.acquisitionParked && <span className="text-purple-600 dark:text-purple-400">parked </span>}
                    {!n.satisfied && n.ageCyclesUnmet > 0 && <span>age {formatInt(n.ageCyclesUnmet)}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}
