export default function Placeholder({ milestone }: { milestone: string }) {
  return (
    <div className="mt-6 rounded-lg border border-dashed border-neutral-300 dark:border-neutral-700 p-8 text-sm text-neutral-500">
      Content for this view ships in <code className="font-mono">{milestone}</code>. See{" "}
      <code className="font-mono">docs/plan.md</code> for the full schedule.
    </div>
  );
}
