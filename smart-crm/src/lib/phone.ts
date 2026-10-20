import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";

/** Normalizes user input to E.164 (+972501234567). Israeli local numbers are the default. */
export function normalizePhone(input: string | null | undefined, defaultCountry: CountryCode = "IL"): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  const candidate = trimmed.startsWith("00") ? `+${trimmed.slice(2)}` : trimmed;
  const parsed = parsePhoneNumberFromString(candidate, defaultCountry);
  if (!parsed || !parsed.isValid()) return null;
  return parsed.number;
}

/** Human formatting: national format for local numbers, international otherwise. */
export function formatPhone(e164: string | null | undefined, homeCountry: CountryCode = "IL"): string {
  if (!e164) return "";
  const parsed = parsePhoneNumberFromString(e164);
  if (!parsed) return e164;
  return parsed.country === homeCountry ? parsed.formatNational() : parsed.formatInternational();
}

/** WhatsApp wa_id (digits only, no +) ↔ E.164. */
export const waIdToE164 = (waId: string) => (waId.startsWith("+") ? waId : `+${waId}`);
export const e164ToWaId = (e164: string) => e164.replace(/^\+/, "");
