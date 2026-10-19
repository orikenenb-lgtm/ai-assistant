/** WhatsApp 24-hour customer-service window. */
export const SERVICE_WINDOW_MS = 24 * 3600 * 1000;

export type WindowState = { open: boolean; closesAt: Date | null };

/** Free-form messages are allowed only within 24h of the customer's last message. */
export function serviceWindow(lastInboundAt: Date | string | null | undefined, now = Date.now()): WindowState {
  if (!lastInboundAt) return { open: false, closesAt: null };
  const closesAt = new Date(new Date(lastInboundAt).getTime() + SERVICE_WINDOW_MS);
  return { open: closesAt.getTime() > now, closesAt };
}
