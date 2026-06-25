interface Props {
  source?: string;
  flag?: string;
}

export default function UnwiredNotice({ source = "Prometheus", flag = "--prometheus-url" }: Props) {
  return (
    <div className="mt-6 rounded-lg border border-dashed border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700/50 p-6 text-sm">
      <div className="font-semibold text-amber-900 dark:text-amber-200">{source} not wired</div>
      <div className="mt-1 text-amber-800 dark:text-amber-300/80">
        Pass <code className="font-mono">{flag}=…</code> on the dashboard binary to enable this view.
      </div>
    </div>
  );
}
