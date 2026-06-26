import { useEffect, useMemo, useRef, useState } from "react";
import type { AlignedData, Series } from "uplot";
import Sparkline from "./Sparkline";

export interface TrendSeries {
  label: string;
  values: number[];
  color: string;
}

/**
 * TimeSeriesChart wraps Sparkline (uPlot) with a ResizeObserver-driven width,
 * so range-query trends can be dropped onto any page. Renders a hint when
 * there's no data.
 */
export default function TimeSeriesChart({
  timestamps,
  series,
  height = 160,
  empty = "No data in the window.",
}: {
  timestamps: number[];
  series: TrendSeries[];
  height?: number;
  empty?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const e = entries[0];
      if (e) setWidth(Math.max(200, e.contentRect.width));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { aligned, cfg } = useMemo<{ aligned: AlignedData | null; cfg: Series[] }>(() => {
    const nonEmpty = series.filter((s) => s.values.length > 0);
    if (timestamps.length === 0 || nonEmpty.length === 0) {
      return { aligned: null, cfg: [{}] };
    }
    const aligned: AlignedData = [timestamps, ...nonEmpty.map((s) => s.values)];
    const cfg: Series[] = [
      {},
      ...nonEmpty.map((s) => ({ label: s.label, stroke: s.color, width: 1.5, points: { show: false } })),
    ];
    return { aligned, cfg };
  }, [timestamps, series]);

  return (
    <div ref={ref} style={{ height }}>
      {aligned && width > 0 ? (
        <Sparkline data={aligned} series={cfg} width={width} height={height - 8} />
      ) : (
        <div className="text-xs text-neutral-500">{empty}</div>
      )}
    </div>
  );
}
