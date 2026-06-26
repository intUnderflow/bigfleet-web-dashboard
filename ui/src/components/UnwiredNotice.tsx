interface Props {
  source?: string;
  flag?: string;
}

export default function UnwiredNotice({ source = "Prometheus", flag = "--prometheus-url" }: Props) {
  return (
    <div className="rounded-xl border border-dashed border-amber-300/70 bg-amber-50 p-6 text-sm dark:border-amber-700/50 dark:bg-amber-950/20">
      <div className="font-semibold text-amber-900 dark:text-amber-200">{source} not wired</div>
      <div className="mt-1 text-amber-800/90 dark:text-amber-300/80">
        Pass <code className="rounded bg-amber-100 px-1 py-0.5 font-mono text-[12px] dark:bg-amber-900/40">{flag}=…</code>{" "}
        on the dashboard binary to enable this view.
      </div>
    </div>
  );
}
