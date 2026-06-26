export default function ErrorBox({ error }: { error: Error }) {
  return (
    <div className="flex items-start gap-2.5 rounded-xl border border-red-300 bg-red-50 p-3.5 text-sm text-red-800 dark:border-red-800/60 dark:bg-red-950/30 dark:text-red-300">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="mt-0.5 shrink-0" aria-hidden="true">
        <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.4" />
        <path d="M8 5v3.5M8 10.6v.01" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
      <span className="min-w-0 break-words font-mono text-xs leading-relaxed">{error.message}</span>
    </div>
  );
}
