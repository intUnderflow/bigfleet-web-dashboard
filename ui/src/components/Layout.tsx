import { NavLink, Outlet } from "react-router-dom";
import { useConfig } from "../lib/useConfig";

type NavItem = { to: string; label: string; end?: boolean };

const navGroups: { heading?: string; items: NavItem[] }[] = [
  { items: [{ to: "/", label: "Overview", end: true }] },
  {
    heading: "Infrastructure",
    items: [
      { to: "/shards", label: "Shards" },
      { to: "/shard-reports", label: "Shard capacity" },
      { to: "/topology", label: "Topology" },
    ],
  },
  {
    heading: "Demand",
    items: [
      { to: "/clusters", label: "Clusters" },
      { to: "/available-capacity", label: "Available capacity" },
      { to: "/needs", label: "Needs" },
    ],
  },
  {
    heading: "Cost",
    items: [{ to: "/finops", label: "FinOps" }],
  },
];

export default function Layout() {
  const { data: cfg } = useConfig();

  return (
    <div className="flex h-full">
      <aside className="flex w-60 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--surface)]">
        <div className="flex items-center gap-2.5 px-5 pt-5 pb-4">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-[var(--accent)] text-[13px] font-bold text-[var(--accent-fg)] shadow-[var(--shadow-sm)]">
            BF
          </span>
          <div className="leading-tight">
            <div className="text-sm font-semibold tracking-tight">BigFleet</div>
            <div className="text-[11px] text-[var(--text-subtle)]">dashboard</div>
          </div>
        </div>

        <nav className="flex flex-1 flex-col gap-5 overflow-y-auto px-3 py-2">
          {navGroups.map((group, gi) => (
            <div key={group.heading ?? `g${gi}`} className="flex flex-col gap-0.5">
              {group.heading && (
                <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-subtle)]">
                  {group.heading}
                </div>
              )}
              {group.items.map((it) => (
                <NavLink
                  key={it.to}
                  to={it.to}
                  end={it.end}
                  className={({ isActive }) =>
                    `rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                      isActive
                        ? "bg-[var(--accent-soft)] text-[var(--accent-soft-fg)]"
                        : "text-[var(--text-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
                    }`
                  }
                >
                  {it.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="border-t border-[var(--border)] px-5 py-3">
          <div className="pb-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-subtle)]">
            Data sources
          </div>
          <div className="space-y-1">
            <WireStatus label="Prometheus" wired={cfg?.prometheusWired} />
            <WireStatus label="Coordinator" wired={cfg?.coordinatorWired} />
            <WireStatus label="Kubeconfig" wired={cfg?.kubeconfigWired} />
          </div>
        </div>
      </aside>

      <main className="flex-1 overflow-auto">
        <div className="mx-auto max-w-[1280px] px-8 py-7">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

function WireStatus({ label, wired }: { label: string; wired: boolean | undefined }) {
  const colour =
    wired === undefined ? "bg-neutral-400" : wired ? "bg-emerald-500" : "bg-neutral-400/60";
  return (
    <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${colour}`} />
      <span>{label}</span>
      <span className="ml-auto text-[10px] uppercase tracking-wide text-[var(--text-subtle)]">
        {wired === undefined ? "" : wired ? "wired" : "off"}
      </span>
    </div>
  );
}
