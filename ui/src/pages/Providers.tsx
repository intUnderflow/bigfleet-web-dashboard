import { useQuery } from "@tanstack/react-query";
import { useConfig } from "../lib/useConfig";
import { api } from "../lib/api";
import PageHeader from "../components/PageHeader";
import UnwiredNotice from "../components/UnwiredNotice";
import ErrorBox from "../components/ErrorBox";

export default function Providers() {
  const cfg = useConfig();
  const wired = cfg.data?.coordinatorWired ?? false;

  const providers = useQuery({
    queryKey: ["providers"],
    queryFn: api.providers,
    enabled: wired,
    refetchInterval: 30_000,
  });

  return (
    <>
      <PageHeader
        title="Providers"
        subtitle="Provider backends registered with the coordinator. BigFleet dials out to these; they are out-of-tree by design."
      />

      {!cfg.isLoading && !wired && <UnwiredNotice source="Coordinator" flag="--coordinator-addr" />}

      {wired && providers.error && (
        <div className="mt-6">
          <ErrorBox error={providers.error as Error} />
        </div>
      )}

      {wired && !providers.error && (
        <section className="mt-6 rounded-lg border border-neutral-200 dark:border-neutral-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 dark:bg-neutral-900/60 text-xs uppercase tracking-wide text-neutral-500">
              <tr>
                <th className="text-left font-medium px-4 py-2">Provider</th>
                <th className="text-left font-medium px-4 py-2">Region</th>
                <th className="text-left font-medium px-4 py-2">Dial address</th>
              </tr>
            </thead>
            <tbody>
              {providers.isLoading && (
                <tr>
                  <td colSpan={3} className="px-4 py-6 text-center text-xs text-neutral-500">
                    Loading…
                  </td>
                </tr>
              )}
              {providers.data && providers.data.providers.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-4 py-6 text-center text-xs text-neutral-500">
                    No providers registered with the coordinator.
                  </td>
                </tr>
              )}
              {providers.data?.providers.map((p) => (
                <tr
                  key={`${p.name}/${p.region}/${p.address}`}
                  className="border-t border-neutral-200 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-900/60"
                >
                  <td className="px-4 py-2 font-medium">{p.name}</td>
                  <td className="px-4 py-2 text-neutral-600 dark:text-neutral-400">{p.region || "—"}</td>
                  <td className="px-4 py-2 font-mono text-xs text-neutral-500">{p.address || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}
