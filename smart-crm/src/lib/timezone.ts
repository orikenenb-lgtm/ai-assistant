/** True for IANA zones the runtime understands (e.g. "Asia/Jerusalem"). */
export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
