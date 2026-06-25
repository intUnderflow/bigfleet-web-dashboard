import { useEffect, useRef } from "react";
import uPlot from "uplot";
import type { Options, AlignedData } from "uplot";
import "uplot/dist/uPlot.min.css";

interface Props {
  data: AlignedData;
  series: NonNullable<Options["series"]>;
  width: number;
  height: number;
  yFormat?: (v: number) => string;
}

export default function Sparkline({ data, series, width, height, yFormat }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const opts: Options = {
      width,
      height,
      series,
      legend: { show: false },
      cursor: { drag: { x: false, y: false } },
      axes: [
        {
          stroke: "#9ca3af",
          grid: { stroke: "rgba(148,163,184,0.12)" },
          ticks: { stroke: "rgba(148,163,184,0.2)" },
        },
        {
          stroke: "#9ca3af",
          grid: { stroke: "rgba(148,163,184,0.12)" },
          ticks: { stroke: "rgba(148,163,184,0.2)" },
          values: yFormat
            ? (_, splits) => splits.map((v) => yFormat(v))
            : undefined,
        },
      ],
    };
    plotRef.current = new uPlot(opts, data, containerRef.current);
    return () => {
      plotRef.current?.destroy();
      plotRef.current = null;
    };
    // mount-only — data/size updates handled below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    plotRef.current?.setData(data);
  }, [data]);

  useEffect(() => {
    plotRef.current?.setSize({ width, height });
  }, [width, height]);

  return <div ref={containerRef} />;
}
