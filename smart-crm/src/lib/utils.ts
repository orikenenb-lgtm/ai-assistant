import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function initials(name: string | null | undefined, fallback = "?"): string {
  // Skip tokens that start with punctuation or digits, e.g. "(דמו)" in "כרם טויס (דמו)".
  const parts = (name ?? "").trim().split(/\s+/).filter((p) => /^\p{L}/u.test(p));
  if (parts.length === 0) return fallback;
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}
