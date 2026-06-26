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
    return <div className="text-xs text-[var(--text-subtle)]">No data.</div>;
  }
  const fmt = (v: number) => (formatValue ? formatValue(v) : v.toLocaleString());
  return (
    <div>
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-[var(--surface-2)]">
        {visible.map((s) => (
          <div
            key={s.label}
            className="h-full first:rounded-l-full last:rounded-r-full"
            style={{ width: `${(s.value / sum) * 100}%`, backgroundColor: s.colour }}
            title={`${s.label}: ${fmt(s.value)}`}
          />
        ))}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-xs">
        {visible.map((s) => (
          <li key={s.label} className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ backgroundColor: s.colour }} />
            <span className="text-[var(--text-muted)]">{s.label}</span>
            <span className="tabular-nums font-medium text-[var(--text)]">{fmt(s.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
