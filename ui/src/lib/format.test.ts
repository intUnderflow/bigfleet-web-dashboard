import { describe, it, expect } from "vitest";
import {
  formatDuration,
  formatInt,
  formatRate,
  formatRelative,
  formatPenaltyBucket,
  formatPercent,
  formatQuantity,
  formatQuantityValue,
  formatResources,
  formatPenalty,
  penaltyOrdinal,
  formatPriorityCompact,
  PENALTY_LADDER_MAX,
} from "./format";

describe("formatInt", () => {
  it("rounds and groups thousands", () => {
    expect(formatInt(1234567)).toBe("1,234,567");
    expect(formatInt(0)).toBe("0");
  });
  it("returns an em dash for null / NaN / Infinity", () => {
    expect(formatInt(null)).toBe("—");
    expect(formatInt(undefined)).toBe("—");
    expect(formatInt(NaN)).toBe("—");
    expect(formatInt(Infinity)).toBe("—");
  });
});

describe("formatDuration", () => {
  it("picks the right unit", () => {
    expect(formatDuration(4.08)).toBe("4.08 s");
    expect(formatDuration(0.5)).toBe("500 ms");
    expect(formatDuration(0.0005)).toBe("500 µs");
    expect(formatDuration(90)).toBe("1m 30s");
  });
  it("dashes negative / null", () => {
    expect(formatDuration(-1)).toBe("—");
    expect(formatDuration(null)).toBe("—");
  });
});

describe("formatRate", () => {
  it("formats per-second and zero", () => {
    expect(formatRate(0)).toBe("0/s");
    expect(formatRate(2.5)).toBe("2.50/s");
  });
  it("switches to per-minute for tiny rates", () => {
    expect(formatRate(0.001)).toBe("0.06/min");
  });
});

describe("formatRelative", () => {
  const now = 1_000_000;
  it("formats s / m / h / d ago", () => {
    expect(formatRelative(now - 10, now)).toBe("10s ago");
    expect(formatRelative(now - 120, now)).toBe("2m ago");
    expect(formatRelative(now - 7200, now)).toBe("2h ago");
    expect(formatRelative(now - 172800, now)).toBe("2d ago");
  });
  it("dashes zero / null", () => {
    expect(formatRelative(0)).toBe("—");
    expect(formatRelative(null)).toBe("—");
  });
});

describe("formatPenaltyBucket", () => {
  it("renders the powers-of-2 dollar buckets + pinned", () => {
    expect(formatPenaltyBucket("pinned")).toBe("Pinned");
    expect(formatPenaltyBucket("0")).toBe("$0");
    expect(formatPenaltyBucket("8")).toBe("$8");
    expect(formatPenaltyBucket("1000")).toBe("$1K");
    expect(formatPenaltyBucket("1000000")).toBe("$1M");
  });
});

describe("formatPercent", () => {
  it("scales a fraction to a percentage", () => {
    expect(formatPercent(0.619)).toBe("61.9%");
    expect(formatPercent(null)).toBe("—");
  });
});

describe("formatQuantity", () => {
  it("humanizes millicpu into cores", () => {
    expect(formatQuantity("cpu", "278500m")).toBe("278.5 cpu");
    expect(formatQuantity("cpu", "8500m")).toBe("8.5 cpu");
    expect(formatQuantity("cpu", "2")).toBe("2 cpu");
  });
  it("normalizes binary memory to the largest sensible unit", () => {
    expect(formatQuantity("memory", "10880Mi")).toBe("10.6 Gi");
    expect(formatQuantity("memory", "2880Mi")).toBe("2.8 Gi");
    expect(formatQuantity("memory", "170Gi")).toBe("170 Gi");
  });
  it("leaves counted resources (gpu) integral with their short key", () => {
    expect(formatQuantity("nvidia.com/gpu", "8")).toBe("8 gpu");
  });
  it("value-only form drops the resource label", () => {
    expect(formatQuantityValue("cpu", "278500m")).toBe("278.5");
    expect(formatQuantityValue("memory", "10880Mi")).toBe("10.6 Gi");
  });
  it("joins a resource map", () => {
    expect(formatResources({ cpu: "128000m", "nvidia.com/gpu": "8" })).toBe("128 cpu · 8 gpu");
  });
});

describe("formatPenalty / penaltyOrdinal", () => {
  it("dollarizes the bucket enum, keeping UNSPECIFIED distinct from ZERO", () => {
    expect(formatPenalty("UNSPECIFIED")).toBe("unset");
    expect(formatPenalty("ZERO")).toBe("$0");
    expect(formatPenalty("HALF_DOLLAR")).toBe("$0.50");
    expect(formatPenalty("4096")).toBe("$4.1K");
    expect(formatPenalty("8388608")).toBe("$8.4M");
    expect(formatPenalty("PINNED")).toBe("pinned");
  });
  it("orders buckets on the log ladder with UNSPECIFIED below ZERO", () => {
    expect(penaltyOrdinal("UNSPECIFIED")).toBe(0);
    expect(penaltyOrdinal("ZERO")).toBe(1);
    expect(penaltyOrdinal("HALF_DOLLAR")).toBe(2);
    expect(penaltyOrdinal("8192")).toBe(16);
    expect(penaltyOrdinal("PINNED")).toBe(PENALTY_LADDER_MAX);
    expect(penaltyOrdinal("UNSPECIFIED")).toBeLessThan(penaltyOrdinal("ZERO"));
  });
});

describe("formatPriorityCompact", () => {
  it("abbreviates billions/millions, leaves comparable values exact", () => {
    expect(formatPriorityCompact(1_000_000_000)).toBe("1B");
    expect(formatPriorityCompact(2_100_000_000)).toBe("2.1B");
    expect(formatPriorityCompact(8_500)).toBe("8,500");
    expect(formatPriorityCompact(100_000)).toBe("100,000");
  });
});
