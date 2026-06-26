import { NavLink, Outlet } from "react-router-dom";
import { useConfig } from "../lib/useConfig";

const navItems = [
  { to: "/", label: "Overview", end: true },
  { to: "/shards", label: "Shards" },
  { to: "/clusters", label: "Clusters" },
  { to: "/topology", label: "Topology" },
  { to: "/shard-reports", label: "Shard reports" },
  { to: "/needs", label: "Needs" },
  { to: "/providers", label: "Providers" },
  { to: "/finops", label: "FinOps" },
];

export default function Layout() {
  const { data: cfg } = useConfig();

  return (
    <div className="flex h-full">
      <aside className="w-56 shrink-0 border-r border-neutral-200 dark:border-neutral-800 p-4 flex flex-col gap-1">
        <div className="px-2 pb-4 text-lg font-semibold tracking-tight">
          BigFleet
          <div className="text-xs font-normal text-neutral-500">dashboard</div>
        </div>
        <nav className="flex flex-col gap-0.5">
          {navItems.map((it) => (
            <NavLink
              key={it.to}
              to={it.to}
              end={it.end}
              className={({ isActive }) =>
                `px-3 py-1.5 rounded-md text-sm transition-colors ${
                  isActive
                    ? "bg-blue-600 text-white"
                    : "text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                }`
              }
            >
              {it.label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto text-xs text-neutral-500 px-2 space-y-1">
          <WireStatus label="Prometheus" wired={cfg?.prometheusWired} />
          <WireStatus label="Coordinator" wired={cfg?.coordinatorWired} />
          <WireStatus label="Kubeconfig" wired={cfg?.kubeconfigWired} />
        </div>
      </aside>
      <main className="flex-1 overflow-auto p-6">
        <Outlet />
      </main>
    </div>
  );
}

function WireStatus({ label, wired }: { label: string; wired: boolean | undefined }) {
  const colour = wired === undefined ? "bg-neutral-300" : wired ? "bg-emerald-500" : "bg-neutral-400";
  return (
    <div className="flex items-center gap-2">
      <span className={`inline-block h-2 w-2 rounded-full ${colour}`} />
      <span>{label}</span>
    </div>
  );
}
