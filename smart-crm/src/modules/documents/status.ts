/** Quote lifecycle. Pure — shared by services, UI and tests. */

export const QUOTE_STATUSES = ["draft", "sent", "viewed", "accepted", "rejected", "expired", "canceled"] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

/**
 * Allowed transitions:
 *   draft  → sent | canceled
 *   sent   → viewed | accepted | rejected | expired | canceled
 *   viewed → accepted | rejected | expired | canceled
 * accepted / rejected / expired / canceled are terminal.
 * (Staff may record a decision the customer gave by phone, hence sent → accepted.)
 */
const TRANSITIONS: Record<QuoteStatus, readonly QuoteStatus[]> = {
  draft: ["sent", "canceled"],
  sent: ["viewed", "accepted", "rejected", "expired", "canceled"],
  viewed: ["accepted", "rejected", "expired", "canceled"],
  accepted: [],
  rejected: [],
  expired: [],
  canceled: [],
};

export function canTransition(from: QuoteStatus, to: QuoteStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function isTerminal(status: QuoteStatus): boolean {
  return TRANSITIONS[status].length === 0;
}

/** Only drafts are editable; everything else is duplicated into a new draft. */
export const isEditable = (status: QuoteStatus) => status === "draft";

/** Statuses in which the customer-facing link accepts a decision. */
export const isAwaitingDecision = (status: QuoteStatus) => status === "sent" || status === "viewed";

export function isQuoteStatus(v: unknown): v is QuoteStatus {
  return typeof v === "string" && (QUOTE_STATUSES as readonly string[]).includes(v);
}
