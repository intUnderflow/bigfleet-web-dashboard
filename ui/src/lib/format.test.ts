import { describe, it, expect } from "vitest";
import {
  formatDuration,
  formatInt,
  formatRate,
  formatRelative,
  formatPenaltyBucket,
  formatPercent,
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
