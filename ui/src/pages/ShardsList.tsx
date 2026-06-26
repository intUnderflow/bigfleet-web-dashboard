import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useConfig } from "../lib/useConfig";
import { api } from "../lib/api";
import { formatDuration, formatInt } from "../lib/format";
import PageHeader from "../components/PageHeader";
import UnwiredNotice from "../components/UnwiredNotice";
import ErrorBox from "../components/ErrorBox";
import { TableShell, THead, TH, TR, TD, MessageRow } from "../components/Table";

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

      {wired && shards.error && <ErrorBox error={shards.error as Error} />}

      {wired && !shards.error && (
        <TableShell>
          <THead>
            <tr>
              <TH>Pod</TH>
              <TH right>Cycle p99</TH>
              <TH right>Machines</TH>
              <TH right>Sessions</TH>
              <TH right>Shortfalls</TH>
            </tr>
          </THead>
          <tbody>
            {shards.isLoading && <MessageRow colSpan={5}>Loading…</MessageRow>}
            {shards.data && shards.data.shards.length === 0 && (
              <MessageRow colSpan={5}>No shards reporting in the last 2 minutes.</MessageRow>
            )}
            {shards.data?.shards.map((s) => {
              const cycleTone =
                s.cycleP99Seconds > 5
                  ? "text-red-600 dark:text-red-400"
                  : s.cycleP99Seconds > 1
                    ? "text-amber-600 dark:text-amber-400"
                    : "";
              return (
                <TR key={s.pod} hover>
                  <TD mono>
                    <Link
                      to={`/shards/${encodeURIComponent(s.pod)}`}
                      className="font-medium text-[var(--accent)] hover:underline"
                    >
                      {s.pod}
                    </Link>
                  </TD>
                  <TD right className={cycleTone}>
                    {formatDuration(s.cycleP99Seconds)}
                  </TD>
                  <TD right>{formatInt(s.machines)}</TD>
                  <TD right>{formatInt(s.activeSessions)}</TD>
                  <TD right className={s.shortfalls > 0 ? "font-medium text-red-600 dark:text-red-400" : "text-[var(--text-muted)]"}>
                    {formatInt(s.shortfalls)}
                  </TD>
                </TR>
              );
            })}
          </tbody>
        </TableShell>
      )}
    </>
  );
}
