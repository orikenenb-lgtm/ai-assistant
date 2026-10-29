/**
 * Phone parsing tuned for Israeli numbers, with a permissive path for
 * international ones. Also understands spoken Hebrew digits ("אפס חמש אפס…"),
 * which is what speech recognition sometimes returns.
 */

const HEBREW_DIGITS: Record<string, string> = {
  אפס: "0",
  אחת: "1",
  אחד: "1",
  שתיים: "2",
  שתים: "2",
  שניים: "2",
  שנים: "2",
  שלוש: "3",
  שלושה: "3",
  ארבע: "4",
  ארבעה: "4",
  חמש: "5",
  חמישה: "5",
  שש: "6",
  שישה: "6",
  שבע: "7",
  שבעה: "7",
  שמונה: "8",
  תשע: "9",
  תשעה: "9",
};

/** Replace spoken Hebrew digit words with digits; leaves other text intact. */
export function spokenDigitsToNumbers(text: string): string {
  return text
    .split(/(\s+|[-,.])/)
    .map((token) => {
      const clean = token.replace(/^ו/, "");
      return HEBREW_DIGITS[token] ?? HEBREW_DIGITS[clean] ?? token;
    })
    .join("");
}

export type ParsedPhone = {
  /** E.164, e.g. +972501234567 */
  e164: string;
  /** Local display, e.g. 050-123-4567 */
  display: string;
};

function formatIsraeliLocal(national: string): string {
  // national = digits without the leading 0, e.g. 501234567 or 31234567
  const local = `0${national}`;
  if (local.length === 10) return `${local.slice(0, 3)}-${local.slice(3, 6)}-${local.slice(6)}`;
  if (local.length === 9) return `${local.slice(0, 2)}-${local.slice(2, 5)}-${local.slice(5)}`;
  return local;
}

/** Parse a phone number typed or spoken by a person. Returns null if invalid. */
export function parsePhone(input: string): ParsedPhone | null {
  if (!input) return null;
  const spoken = spokenDigitsToNumbers(input);
  const hasPlus = /^\s*\+/.test(spoken) || /^\s*00/.test(spoken);
  let digits = spoken.replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("00")) digits = digits.slice(2);

  let national: string | null = null;
  if (digits.startsWith("972")) {
    national = digits.slice(3).replace(/^0/, "");
  } else if (!hasPlus && digits.startsWith("0")) {
    national = digits.slice(1);
  }

  if (national !== null) {
    // Mobile 5X + 7 digits; VoIP 7X + 7 digits; landline 2/3/4/8/9 + 7 digits.
    if (/^(5\d|7\d)\d{7}$/.test(national) || /^[23489]\d{7}$/.test(national)) {
      return { e164: `+972${national}`, display: formatIsraeliLocal(national) };
    }
    return null;
  }

  if (hasPlus && /^[1-9]\d{7,14}$/.test(digits)) {
    return { e164: `+${digits}`, display: `+${digits}` };
  }
  return null;
}

/** Find the first plausible phone number inside free text (e.g. a chat message). */
export function extractPhone(text: string): ParsedPhone | null {
  const spoken = spokenDigitsToNumbers(text);
  const candidates = spoken.match(/(\+|00)?[\d][\d\s\-().]{6,20}\d/g) ?? [];
  for (const c of candidates) {
    const parsed = parsePhone(c);
    if (parsed) return parsed;
  }
  return null;
}
