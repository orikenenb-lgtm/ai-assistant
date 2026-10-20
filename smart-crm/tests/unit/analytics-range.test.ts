import { describe, expect, it } from "vitest";
import {
  bucketFor,
  bucketKeys,
  bucketStart,
  fillBuckets,
  localDate,
  previousRange,
  resolveRange,
  tzOffsetMinutes,
  zonedMidnight,
} from "@/modules/analytics/range";
import { durationParts, median, percentChange, ratio, topNWithOther, weightedValueCents, winRate } from "@/modules/analytics/math";

const TZ = "Asia/Jerusalem";

describe("time zone math", () => {
  it("knows Israel's offsets in winter and summer", () => {
    expect(tzOffsetMinutes(new Date("2026-01-15T12:00:00Z"), TZ)).toBe(120);
    expect(tzOffsetMinutes(new Date("2026-07-15T12:00:00Z"), TZ)).toBe(180);
  });

  it("finds local midnight as a UTC instant", () => {
    expect(zonedMidnight(2026, 1, 15, TZ).toISOString()).toBe("2026-01-14T22:00:00.000Z");
    expect(zonedMidnight(2026, 7, 15, TZ).toISOString()).toBe("2026-07-14T21:00:00.000Z");
  });

  it("handles the spring-forward and fall-back days (Israel DST 2026: Mar 27 / Oct 25)", () => {
    // Midnight before the switch is still standard time (+2).
    expect(zonedMidnight(2026, 3, 27, TZ).toISOString()).toBe("2026-03-26T22:00:00.000Z");
    // The next midnight is already summer time (+3): that local day is 23 hours long.
    expect(zonedMidnight(2026, 3, 28, TZ).toISOString()).toBe("2026-03-27T21:00:00.000Z");
    // Fall back: Oct 25 local midnight is +3, Oct 26 is +2 (a 25-hour day).
    expect(zonedMidnight(2026, 10, 25, TZ).toISOString()).toBe("2026-10-24T21:00:00.000Z");
    expect(zonedMidnight(2026, 10, 26, TZ).toISOString()).toBe("2026-10-25T22:00:00.000Z");
  });

  it("assigns instants to the local calendar day", () => {
    // 23:30 UTC on Jan 31 is already Feb 1 in Israel.
    expect(localDate(new Date("2026-01-31T23:30:00Z"), TZ)).toBe("2026-02-01");
    expect(localDate(new Date("2026-01-31T21:30:00Z"), TZ)).toBe("2026-01-31");
  });
});

describe("range presets", () => {
  const now = new Date("2026-10-19T09:00:00Z"); // Monday 12:00 in Israel

  it("rolling windows include today", () => {
    const r = resolveRange("7d", { timeZone: TZ, now });
    expect([r.fromDate, r.toDate]).toEqual(["2026-10-13", "2026-10-19"]);
    expect(r.from.toISOString()).toBe("2026-10-12T21:00:00.000Z");
    expect(r.to.toISOString()).toBe("2026-10-19T21:00:00.000Z");
    expect(r.bucket).toBe("day");
  });

  it("calendar presets", () => {
    expect(resolveRange("this_month", { timeZone: TZ, now })).toMatchObject({ fromDate: "2026-10-01", toDate: "2026-10-19" });
    expect(resolveRange("last_month", { timeZone: TZ, now })).toMatchObject({ fromDate: "2026-09-01", toDate: "2026-09-30" });
    expect(resolveRange("this_quarter", { timeZone: TZ, now })).toMatchObject({ fromDate: "2026-10-01", toDate: "2026-10-19" });
    expect(resolveRange("this_year", { timeZone: TZ, now })).toMatchObject({ fromDate: "2026-01-01", toDate: "2026-10-19", bucket: "month" });
    expect(resolveRange("90d", { timeZone: TZ, now }).bucket).toBe("week");
  });

  it("last month spanning a DST change ends at local midnight", () => {
    const r = resolveRange("last_month", { timeZone: TZ, now: new Date("2026-11-03T10:00:00Z") });
    expect([r.fromDate, r.toDate]).toEqual(["2026-10-01", "2026-10-31"]);
    expect(r.from.toISOString()).toBe("2026-09-30T21:00:00.000Z"); // +3 (summer)
    expect(r.to.toISOString()).toBe("2026-10-31T22:00:00.000Z"); // +2 (winter)
  });

  it("custom ranges are inclusive, swapped when reversed, and fall back when invalid", () => {
    expect(resolveRange("custom", { from: "2026-02-10", to: "2026-02-01", timeZone: TZ, now })).toMatchObject({
      fromDate: "2026-02-01",
      toDate: "2026-02-10",
    });
    expect(resolveRange("custom", { from: "2026-02-31", to: "2026-03-01", timeZone: TZ, now }).preset).toBe("30d");
    expect(resolveRange("custom", { from: "nope", to: null, timeZone: TZ, now }).preset).toBe("30d");
  });

  it("previous period has the same length", () => {
    const r = resolveRange("7d", { timeZone: TZ, now });
    expect(previousRange(r, TZ)).toMatchObject({ fromDate: "2026-10-06", toDate: "2026-10-12" });
  });
});

describe("buckets", () => {
  it("chooses bucket size by length", () => {
    expect(bucketFor(7)).toBe("day");
    expect(bucketFor(60)).toBe("week");
    expect(bucketFor(365)).toBe("month");
  });

  it("honors a requested bucket only when the range is short enough", () => {
    expect(resolveRange("custom", { from: "2026-03-01", to: "2026-04-30", bucket: "month", timeZone: TZ }).bucket).toBe("month");
    expect(resolveRange("custom", { from: "2026-03-01", to: "2026-04-30", bucket: "day", timeZone: TZ }).bucket).toBe("day");
    expect(resolveRange("custom", { from: "2025-01-01", to: "2026-04-30", bucket: "day", timeZone: TZ }).bucket).toBe("month");
    expect(resolveRange("custom", { from: "2026-03-01", to: "2026-04-30", bucket: "auto", timeZone: TZ }).bucket).toBe("week");
  });

  it("weeks start on Sunday", () => {
    expect(bucketStart("2026-10-19", "week")).toBe("2026-10-18");
    expect(bucketStart("2026-10-18", "week")).toBe("2026-10-18");
    expect(bucketStart("2026-10-19", "month")).toBe("2026-10-01");
  });

  it("enumerates and fills every bucket", () => {
    const keys = bucketKeys({ fromDate: "2026-08-15", toDate: "2026-10-19", bucket: "month" });
    expect(keys).toEqual(["2026-08-01", "2026-09-01", "2026-10-01"]);
    const filled = fillBuckets(keys, [{ bucket: "2026-09-01", v: 5 }], (bucket) => ({ bucket, v: 0 }));
    expect(filled.map((r) => r.v)).toEqual([0, 5, 0]);
  });
});

describe("metric math", () => {
  it("win rate", () => {
    expect(winRate(3, 1)).toBe(0.75);
    expect(winRate(0, 0)).toBeNull();
  });

  it("weights by the deal override, else the stage probability", () => {
    expect(weightedValueCents(100_000, null, 25)).toBe(25_000);
    expect(weightedValueCents(100_000, 80, 25)).toBe(80_000);
    expect(weightedValueCents(100_000, 140, 25)).toBe(100_000);
  });

  it("percent change, ratio, median, top-N", () => {
    expect(percentChange(150, 100)).toBe(0.5);
    expect(percentChange(5, 0)).toBeNull();
    expect(ratio(1, 4)).toBe(0.25);
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
    expect(
      topNWithOther(
        [
          { key: "a", value: 1 },
          { key: "b", value: 5 },
          { key: "c", value: 3 },
          { key: "d", value: 2 },
        ],
        2,
      ),
    ).toEqual([
      { key: "b", value: 5 },
      { key: "c", value: 3 },
      { key: "__other", value: 3 },
    ]);
  });

  it("formats durations", () => {
    expect(durationParts(45)).toEqual({ value: 45, unit: "second" });
    expect(durationParts(90)).toEqual({ value: 1.5, unit: "minute" });
    expect(durationParts(5400)).toEqual({ value: 1.5, unit: "hour" });
    expect(durationParts(172800)).toEqual({ value: 2, unit: "day" });
  });
});
