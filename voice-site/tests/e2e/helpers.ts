import type { Page } from "@playwright/test";
import { HOOK_PORT } from "../../playwright.config";

export type ReceivedLead = {
  signature: string | null;
  body: { type: string; lead: { name: string; phone: string; business: string; source: string; callback: string } };
};

export async function receivedLeads(): Promise<ReceivedLead[]> {
  const res = await fetch(`http://127.0.0.1:${HOOK_PORT}/received`);
  return (await res.json()) as ReceivedLead[];
}

/** Collect console errors and uncaught exceptions for a page. */
export function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

/** Scroll through the page so every scroll-reveal section becomes visible. */
export async function revealAll(page: Page) {
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 500) {
      window.scrollTo({ top: y, behavior: "instant" });
      await new Promise((r) => setTimeout(r, 40));
    }
    window.scrollTo({ top: 0, behavior: "instant" });
  });
}
