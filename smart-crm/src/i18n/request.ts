import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale, type Locale } from "./config";

export async function resolveLocale(): Promise<Locale> {
  const fromCookie = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(fromCookie)) return fromCookie;
  const accept = (await headers()).get("accept-language") ?? "";
  if (/^en\b/i.test(accept.trim())) return "en";
  return DEFAULT_LOCALE;
}

export default getRequestConfig(async () => {
  const locale = await resolveLocale();
  return {
    locale,
    timeZone: "Asia/Jerusalem",
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
