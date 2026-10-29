/** Shared by the browser form and the server schema (no zod here, keeps the client bundle small). */

export const LEAD_SOURCES = ["form", "demo-agent"] as const;
export const CALLBACK_WINDOWS = ["asap", "morning", "afternoon", "evening"] as const;

export const CALLBACK_LABELS: Record<(typeof CALLBACK_WINDOWS)[number], string> = {
  asap: "כמה שיותר מהר",
  morning: "בבוקר",
  afternoon: "אחר הצהריים",
  evening: "בערב",
};
