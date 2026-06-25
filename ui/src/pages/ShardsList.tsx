import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useConfig } from "../lib/useConfig";
import { api } from "../lib/api";
import { formatDuration, formatInt } from "../lib/format";
import PageHeader from "../components/PageHeader";
import UnwiredNotice from "../components/UnwiredNotice";
import ErrorBox from "../components/ErrorBox";

export default function ShardsList() {
  const cfg = useConfig();
  const wired = cfg.data?.prometheusWired ?? false;

  const shards = useQuery({
    queryKey: ["shards"],
    queryFn: api.shards,
    enabled: wired,
    refetchInterval: 15_000,
  });

  return (
    <>
      <PageHeader title="Shards" subtitle="Per-shard health, inventory, and decision-engine breakdown." />

      {!cfg.isLoading && !wired && <UnwiredNotice />}

      {wired && shards.error && (
        <div className="mt-6">
          <ErrorBox error={shards.error as Error} />
        </div>
      )}

      {wired && !shards.error && (
        <section className="mt-6 rounded-lg border border-neutral-200 dark:border-neutral-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 dark:bg-neutral-900/60 text-xs uppercase tracking-wide text-neutral-500">
              <tr>
                <th className="text-left font-medium px-4 py-2">Pod</th>
                <th className="text-right font-medium px-4 py-2">Cycle p99</th>
                <th className="text-right font-medium px-4 py-2">Machines</th>
                <th className="text-right font-medium px-4 py-2">Sessions</th>
                <th className="text-right font-medium px-4 py-2">Shortfalls</th>
              </tr>
            </thead>
            <tbody>
              {shards.isLoading && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-xs text-neutral-500">
                    Loading…
                  </td>
                </tr>
              )}
              {shards.data && shards.data.shards.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-xs text-neutral-500">
                    No shards reporting in the last 2 minutes.
                  </td>
                </tr>
              )}
              {shards.data?.shards.map((s) => {
                const cycleTone =
                  s.cycleP99Seconds > 5
                    ? "text-red-600 dark:text-red-400"
                    : s.cycleP99Seconds > 1
                    ? "text-amber-600 dark:text-amber-400"
                    : "";
                const shortfallTone =
                  s.shortfalls > 0 ? "text-red-600 dark:text-red-400 font-medium" : "text-neutral-500";
                return (
                  <tr
                    key={s.pod}
                    className="border-t border-neutral-200 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-900/60"
                  >
                    <td className="px-4 py-2 font-mono text-xs">
                      <Link to={`/shards/${encodeURIComponent(s.pod)}`} className="text-blue-600 hover:underline">
                        {s.pod}
                      </Link>
                    </td>
                    <td className={`px-4 py-2 text-right tabular-nums ${cycleTone}`}>
                      {formatDuration(s.cycleP99Seconds)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatInt(s.machines)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatInt(s.activeSessions)}</td>
                    <td className={`px-4 py-2 text-right tabular-nums ${shortfallTone}`}>
                      {formatInt(s.shortfalls)}
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
