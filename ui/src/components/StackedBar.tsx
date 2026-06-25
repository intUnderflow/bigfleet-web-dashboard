interface Segment {
  label: string;
  value: number;
  colour: string;
}

interface Props {
  segments: Segment[];
  total?: number;
  formatValue?: (v: number) => string;
}

export default function StackedBar({ segments, total, formatValue }: Props) {
  const sum = total ?? segments.reduce((s, x) => s + x.value, 0);
  const visible = segments.filter((s) => s.value > 0);
  if (visible.length === 0 || sum === 0) {
    return <div className="text-xs text-neutral-500">empty</div>;
  }
  return (
    <div>
      <div className="flex h-3 w-full overflow-hidden rounded-md border border-neutral-200 dark:border-neutral-800">
        {visible.map((s) => (
          <div
            key={s.label}
            className="h-full"
            style={{ width: `${(s.value / sum) * 100}%`, backgroundColor: s.colour }}
            title={`${s.label}: ${formatValue ? formatValue(s.value) : s.value.toLocaleString()}`}
          />
        ))}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {visible.map((s) => (
          <li key={s.label} className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: s.colour }} />
            <span className="text-neutral-700 dark:text-neutral-300">{s.label}</span>
            <span className="tabular-nums text-neutral-500">
              {formatValue ? formatValue(s.value) : s.value.toLocaleString()}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
