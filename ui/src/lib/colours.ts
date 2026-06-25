export const stateColours: Record<string, string> = {
  Speculative: "#94a3b8",
  Creating: "#93c5fd",
  Idle: "#3b82f6",
  Configuring: "#fbbf24",
  Configured: "#10b981",
  Draining: "#f59e0b",
  Deleting: "#b45309",
  Failed: "#ef4444",
};

export const capacityTypeColours: Record<string, string> = {
  BareMetal: "#475569",
  Reserved: "#6366f1",
  OnDemand: "#3b82f6",
  Spot: "#f59e0b",
};

const fallback = ["#0891b2", "#7c3aed", "#db2777", "#65a30d", "#ea580c", "#0ea5e9"];

export function colourFor(palette: Record<string, string>, key: string, idx: number): string {
  return palette[key] ?? fallback[idx % fallback.length] ?? "#888";
}

export const crPhaseColours: Record<string, string> = {
  Pending: "#f59e0b",
  Acknowledged: "#10b981",
};

export const upcomingNodePhaseColours: Record<string, string> = {
  Provisioning: "#93c5fd",
  Launched: "#3b82f6",
  Registered: "#6366f1",
  Ready: "#10b981",
  Draining: "#f59e0b",
  Drained: "#94a3b8",
  Failed: "#ef4444",
};
