/** Joins class names, skipping falsy values. */
export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

/**
 * A config value counts as "not set" when it is empty or still an
 * UPPER_SNAKE_CASE placeholder token such as "NAIL_STUDIO_NAME".
 */
export function isPlaceholder(value: string | null | undefined): boolean {
  if (!value) return true;
  const trimmed = value.trim();
  return trimmed === "" || /^[A-Z][A-Z0-9_]*$/.test(trimmed);
}

export function hasValue(value: string | null | undefined): value is string {
  return !isPlaceholder(value);
}

/** Returns the URL only if it is a valid absolute https:// URL, otherwise null. */
export function safeHttpsUrl(value: string | null | undefined): string | null {
  if (!hasValue(value)) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Builds a `tel:` href from a display phone number. */
export function toTelHref(phone: string): string | null {
  if (!hasValue(phone)) return null;
  const digits = phone.replace(/[^\d+]/g, "");
  return digits.length >= 7 ? `tel:${digits}` : null;
}

/** Builds a wa.me link from an international number (e.g. "972500000000"). */
export function toWhatsAppHref(number: string, message?: string): string | null {
  if (!hasValue(number)) return null;
  const digits = number.replace(/\D/g, "");
  if (digits.length < 8) return null;
  const query = message ? `?text=${encodeURIComponent(message)}` : "";
  return `https://wa.me/${digits}${query}`;
}

export function formatPrice(price: number, locale = "he-IL"): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "ILS",
    maximumFractionDigits: 0,
  }).format(price);
}
