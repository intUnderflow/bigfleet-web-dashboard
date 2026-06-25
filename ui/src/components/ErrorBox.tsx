export default function ErrorBox({ error }: { error: Error }) {
  return (
    <div className="rounded border border-red-300 bg-red-50 dark:bg-red-950/30 dark:border-red-800 p-3 text-xs text-red-800 dark:text-red-300">
      {error.message}
    </div>
  );
}
