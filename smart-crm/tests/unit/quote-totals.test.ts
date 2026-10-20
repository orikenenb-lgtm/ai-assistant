import { describe, expect, it } from "vitest";
import {
  computeLine,
  computeQuoteTotals,
  decimalStringToMilli,
  milliToDecimalString,
  parseMoney,
  parsePercent,
  parseQuantity,
} from "@/modules/documents/totals";

describe("quote totals", () => {
  it("computes a simple quote with 18% VAT", () => {
    const t = computeQuoteTotals({
      lines: [
        { quantityMilli: 2000, unitPriceCents: 10_000, discountBp: 0 }, // 2 × 100.00
        { quantityMilli: 1000, unitPriceCents: 5_050, discountBp: 0 }, // 1 × 50.50
      ],
      discountBp: 0,
      taxRateBp: 1800,
    });
    expect(t.subtotalCents).toBe(25_050);
    expect(t.taxCents).toBe(4_509); // 250.50 × 18% = 45.09
    expect(t.totalCents).toBe(29_559);
  });

  it("rounds half-up at each documented step", () => {
    // 1.5 × 0.33 = 0.495 → 0.50 (50 agorot); 10% discount of 50 = 5
    const line = computeLine({ quantityMilli: 1500, unitPriceCents: 33, discountBp: 1000 });
    expect(line).toMatchObject({ grossCents: 50, discountCents: 5, totalCents: 45 });
    // VAT 17% of 0.45 = 0.0765 → 0.08
    expect(computeQuoteTotals({ lines: [line], discountBp: 0, taxRateBp: 1700 }).taxCents).toBe(8);
    // 0.125 → 0.13 (half rounds up)
    expect(computeLine({ quantityMilli: 125, unitPriceCents: 100, discountBp: 0 }).totalCents).toBe(13);
  });

  it("applies line discounts, then the quote discount, then VAT", () => {
    const t = computeQuoteTotals({
      lines: [{ quantityMilli: 10_000, unitPriceCents: 1_000, discountBp: 2_500 }], // 100.00 − 25% = 75.00
      discountBp: 1_000, // −10% = 67.50
      taxRateBp: 1_800, // 12.15
    });
    expect(t).toMatchObject({ subtotalCents: 7_500, discountCents: 750, taxableCents: 6_750, taxCents: 1_215, totalCents: 7_965 });
  });

  it("handles zero prices, zero VAT and 100% discounts", () => {
    expect(computeQuoteTotals({ lines: [], discountBp: 0, taxRateBp: 1800 }).totalCents).toBe(0);
    expect(computeQuoteTotals({ lines: [{ quantityMilli: 1000, unitPriceCents: 0, discountBp: 0 }], discountBp: 0, taxRateBp: 0 }).totalCents).toBe(0);
    expect(computeQuoteTotals({ lines: [{ quantityMilli: 1000, unitPriceCents: 500, discountBp: 10_000 }], discountBp: 0, taxRateBp: 1800 }).totalCents).toBe(0);
  });

  it("stays exact for very large values (BigInt intermediates)", () => {
    const t = computeQuoteTotals({
      lines: [{ quantityMilli: 1_000_000_000, unitPriceCents: 100_000_000, discountBp: 0 }], // 1,000,000 × 1,000,000.00
      discountBp: 0,
      taxRateBp: 1800,
    });
    expect(t.subtotalCents).toBe(100_000_000_000_000);
    expect(t.taxCents).toBe(18_000_000_000_000);
    expect(Number.isSafeInteger(t.totalCents)).toBe(true);
  });

  it("rejects out-of-range input", () => {
    expect(() => computeLine({ quantityMilli: 0, unitPriceCents: 100, discountBp: 0 })).toThrow(RangeError);
    expect(() => computeLine({ quantityMilli: 1000, unitPriceCents: -1, discountBp: 0 })).toThrow(RangeError);
    expect(() => computeLine({ quantityMilli: 1000, unitPriceCents: 1, discountBp: 10_001 })).toThrow(RangeError);
    expect(() => computeLine({ quantityMilli: 1.5, unitPriceCents: 1, discountBp: 0 })).toThrow(RangeError);
  });

  it("parses user input strictly", () => {
    expect(parseQuantity("1.5")).toBe(1500);
    expect(parseQuantity("2")).toBe(2000);
    expect(parseQuantity("0.001")).toBe(1);
    expect(parseQuantity("1,000.25")).toBe(1_000_250);
    expect(parseQuantity("0")).toBeNull();
    expect(parseQuantity("1.2345")).toBeNull();
    expect(parseQuantity("-1")).toBeNull();
    expect(parseMoney("12.5")).toBe(1250);
    expect(parseMoney("0")).toBe(0);
    expect(parseMoney("1.999")).toBeNull();
    expect(parsePercent("17.5")).toBe(1750);
    expect(parsePercent("100")).toBe(10_000);
    expect(parsePercent("101")).toBeNull();
  });

  it("round-trips numeric(12,3) strings", () => {
    expect(milliToDecimalString(1500)).toBe("1.500");
    expect(milliToDecimalString(1)).toBe("0.001");
    expect(decimalStringToMilli("2.500")).toBe(2500);
    expect(decimalStringToMilli("3")).toBe(3000);
  });
});
