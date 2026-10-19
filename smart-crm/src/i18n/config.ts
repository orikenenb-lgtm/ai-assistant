export const LOCALES = ["he", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "he";
export const LOCALE_COOKIE = "NEXT_LOCALE";

export const isLocale = (v: unknown): v is Locale => typeof v === "string" && (LOCALES as readonly string[]).includes(v);
export const dirOf = (locale: Locale) => (locale === "he" ? "rtl" : "ltr");
