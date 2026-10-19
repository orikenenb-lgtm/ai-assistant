/**
 * Quote totals — the ONE implementation used by the editor (live preview) and
 * by the server (authoritative; client totals are never trusted).
 *
 * Money is integer minor units (agorot/cents); quantities are integer
 * thousandths ("milli" units, 3 decimals). Intermediate products use BigInt so
 * nothing overflows. Rounding is half-up, applied in this order:
 *   1. line gross      = round(quantity × unit price)
 *   2. line discount   = round(line gross × line discount %)
 *   3. line total      = line gross − line discount
 *   4. subtotal        = Σ line totals
 *   5. quote discount  = round(subtotal × quote discount %)
 *   6. VAT             = round((subtotal − quote discount) × VAT rate)
 *   7. total           = subtotal − quote discount + VAT
 * Percentages are basis points (1% = 100 bp).
 */

export const MAX_QUANTITY_MILLI = 1_000_000_000; // 1,000,000.000 units
export const MAX_UNIT_PRICE_CENTS = 100_000_000_000; // 1,000,000,000.00
export const MAX_LINES = 200;

export type LineInput = { quantityMilli: number; unitPriceCents: number; discountBp: number };
export type LineResult = LineInput & { grossCents: number; discountCents: number; totalCents: number };
export type QuoteTotals = {
  lines: LineResult[];
  subtotalCents: number;
  discountCents: number;
  taxableCents: number;
  taxCents: number;
  totalCents: number;
};

// BigInt() instead of literals: the project's TS target predates ES2020 literal syntax.
const ZERO = BigInt(0);
const TWO = BigInt(2);
const THOUSAND = BigInt(1000);
const TEN_THOUSAND = BigInt(10_000);

/** round(n / d) half-up for non-negative BigInts. */
function divRoundHalfUp(n: bigint, d: bigint): bigint {
  return (n * TWO + d) / (TWO * d);
}

function assertInt(name: string, v: number, min: number, max: number) {
  if (!Number.isInteger(v) || v < min || v > max) throw new RangeError(`${name} out of range: ${v}`);
}

export function computeLine(line: LineInput): LineResult {
  assertInt("quantityMilli", line.quantityMilli, 1, MAX_QUANTITY_MILLI);
  assertInt("unitPriceCents", line.unitPriceCents, 0, MAX_UNIT_PRICE_CENTS);
  assertInt("discountBp", line.discountBp, 0, 10_000);
  const gross = divRoundHalfUp(BigInt(line.quantityMilli) * BigInt(line.unitPriceCents), THOUSAND);
  const discount = divRoundHalfUp(gross * BigInt(line.discountBp), TEN_THOUSAND);
  return { ...line, grossCents: Number(gross), discountCents: Number(discount), totalCents: Number(gross - discount) };
}

export function computeQuoteTotals(input: { lines: LineInput[]; discountBp: number; taxRateBp: number }): QuoteTotals {
  assertInt("discountBp", input.discountBp, 0, 10_000);
  assertInt("taxRateBp", input.taxRateBp, 0, 10_000);
  if (input.lines.length > MAX_LINES) throw new RangeError("too many lines");
  const lines = input.lines.map(computeLine);
  const subtotal = lines.reduce((s, l) => s + BigInt(l.totalCents), ZERO);
  const discount = divRoundHalfUp(subtotal * BigInt(input.discountBp), TEN_THOUSAND);
  const taxable = subtotal - discount;
  const tax = divRoundHalfUp(taxable * BigInt(input.taxRateBp), TEN_THOUSAND);
  const total = taxable + tax;
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError("total too large");
  return {
    lines,
    subtotalCents: Number(subtotal),
    discountCents: Number(discount),
    taxableCents: Number(taxable),
    taxCents: Number(tax),
    totalCents: Number(total),
  };
}

/** "1.5" → 1500 milli-units; null when not a positive number with ≤3 decimals. */
export function parseQuantity(input: string | number): number | null {
  const s = String(input).trim().replace(/,/g, "");
  if (!/^\d+(\.\d{1,3})?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  const milli = Number(whole) * 1000 + Number(frac.padEnd(3, "0"));
  return milli >= 1 && milli <= MAX_QUANTITY_MILLI ? milli : null;
}

/** "12.5" / "12" → 1250 cents; null when invalid (max 2 decimals). */
export function parseMoney(input: string | number): number | null {
  const s = String(input).trim().replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  return cents <= MAX_UNIT_PRICE_CENTS ? cents : null;
}

/** "17" / "17.5" percent → basis points (0–10000), null when invalid. */
export function parsePercent(input: string | number): number | null {
  const s = String(input).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  const bp = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  return bp <= 10_000 ? bp : null;
}

export const milliToQuantity = (milli: number) => milli / 1000;
export const quantityToMilli = (q: number | string) => parseQuantity(q) ?? 0;
export const bpToPercent = (bp: number) => bp / 100;

/** Numeric(12,3) string for the database. */
export function milliToDecimalString(milli: number): string {
  return `${Math.floor(milli / 1000)}.${String(milli % 1000).padStart(3, "0")}`;
}

/** Inverse of milliToDecimalString for values read from numeric columns. */
export function decimalStringToMilli(value: string): number {
  const [whole, frac = ""] = value.split(".");
  return Number(whole) * 1000 + Number(frac.padEnd(3, "0").slice(0, 3));
}
