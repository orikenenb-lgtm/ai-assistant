import { describe, expect, it } from "vitest";
import { dayKey, formatDayLabel } from "@/lib/format";

// 2026-10-19 10:00 in Israel (UTC+3 in October).
const NOW = new Date("2026-10-19T07:00:00Z");

describe("dayKey", () => {
  it("uses the calendar day of the given time zone", () => {
    // 22:30 UTC on the 18th is already the 19th in Israel.
    expect(dayKey("2026-10-18T22:30:00Z")).toBe("2026-10-19");
    expect(dayKey("2026-10-18T22:30:00Z", "UTC")).toBe("2026-10-18");
  });
});

describe("formatDayLabel", () => {
  it("says today and yesterday in both languages", () => {
    expect(formatDayLabel("2026-10-19T05:00:00Z", "he", "Asia/Jerusalem", NOW)).toBe("היום");
    expect(formatDayLabel("2026-10-18T05:00:00Z", "he", "Asia/Jerusalem", NOW)).toBe("אתמול");
    expect(formatDayLabel("2026-10-19T05:00:00Z", "en", "Asia/Jerusalem", NOW)).toBe("Today");
    expect(formatDayLabel("2026-10-18T05:00:00Z", "en", "Asia/Jerusalem", NOW)).toBe("Yesterday");
  });

  it("treats a late-evening UTC time as the next local day", () => {
    expect(formatDayLabel("2026-10-18T22:30:00Z", "en", "Asia/Jerusalem", NOW)).toBe("Today");
  });

  it("shows the weekday within the last week and the full date before that", () => {
    expect(formatDayLabel("2026-10-15T09:00:00Z", "en", "Asia/Jerusalem", NOW)).toBe("Thursday");
    expect(formatDayLabel("2026-10-05T09:00:00Z", "en", "Asia/Jerusalem", NOW)).toBe("Monday, October 5");
  });

  it("adds the year for dates in another year", () => {
    expect(formatDayLabel("2025-12-31T09:00:00Z", "en", "Asia/Jerusalem", NOW)).toBe("Wednesday, December 31, 2025");
  });
});
