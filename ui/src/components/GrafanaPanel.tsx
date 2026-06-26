// Grafana embedding (roadmap v0.2): for the timeseries panels the BigFleet
// scaletest Grafana dashboard already nails, embed via iframe behind
// --grafana-url rather than re-rendering them in React. Both components
// render nothing when grafanaUrl is unset, so callers can drop them in
// unconditionally.

function base(grafanaUrl: string): string {
  return grafanaUrl.replace(/\/+$/, "");
}

function theme(): "dark" | "light" {
  if (typeof window !== "undefined" && window.matchMedia) {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return "light";
}

/** GrafanaPanel embeds a single dashboard panel via Grafana's d-solo route. */
export default function GrafanaPanel({
  grafanaUrl,
  uid,
  slug = "dashboard",
  panelId,
  title,
  height = 240,
  from = "now-1h",
  to = "now",
}: {
  grafanaUrl: string | undefined;
  uid: string;
  slug?: string;
  panelId: number;
  title?: string;
  height?: number;
  from?: string;
  to?: string;
}) {
  if (!grafanaUrl) return null;
  const src =
    `${base(grafanaUrl)}/d-solo/${encodeURIComponent(uid)}/${encodeURIComponent(slug)}` +
    `?orgId=1&panelId=${panelId}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&theme=${theme()}`;
  return (
    <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 overflow-hidden bg-white dark:bg-neutral-900">
      {title && (
        <div className="px-3 py-1.5 text-xs font-medium text-neutral-500 border-b border-neutral-100 dark:border-neutral-800">
          {title}
        </div>
      )}
      <iframe
        title={title ?? `grafana-panel-${panelId}`}
        src={src}
        height={height}
        className="w-full block border-0"
        loading="lazy"
      />
    </div>
  );
}

/** GrafanaLink is a deep link to the full dashboard in Grafana. */
export function GrafanaLink({
  grafanaUrl,
  uid,
  slug = "dashboard",
  label = "Open in Grafana",
}: {
  grafanaUrl: string | undefined;
  uid: string;
  slug?: string;
  label?: string;
}) {
  if (!grafanaUrl) return null;
  return (
    <a
      href={`${base(grafanaUrl)}/d/${encodeURIComponent(uid)}/${encodeURIComponent(slug)}`}
      target="_blank"
      rel="noreferrer"
      className="text-xs text-blue-600 hover:underline"
    >
      {label} ↗
    </a>
  );
}
