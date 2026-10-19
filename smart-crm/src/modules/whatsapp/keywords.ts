/** Inbound keyword handling (opt-out and human handoff), Hebrew and English. */

const OPT_OUT = new Set(["stop", "unsubscribe", "stopall", "cancel", "הסר", "הסרה", "עצור", "הפסק", "הסירו אותי", "הסר אותי"]);
const HANDOFF_EXACT = new Set(["agent", "human", "representative", "נציג", "נציגה", "נציג אנושי"]);
const HANDOFF_CONTAINS = ["נציג", "לדבר עם בן אדם", "talk to a human", "speak to an agent"];

/** Lowercases, trims and strips punctuation/emoji so "הסר!" and " STOP " match. */
export function normalizeKeyword(text: string | null | undefined): string {
  return (text ?? "")
    .toLowerCase()
    .replace(/[\p{P}\p{S}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Whole-message opt-out request (a keyword inside a longer sentence does not count). */
export function isOptOut(text: string | null | undefined): boolean {
  return OPT_OUT.has(normalizeKeyword(text));
}

export function wantsHuman(text: string | null | undefined): boolean {
  const n = normalizeKeyword(text);
  if (!n) return false;
  return HANDOFF_EXACT.has(n) || HANDOFF_CONTAINS.some((k) => n.includes(k));
}
