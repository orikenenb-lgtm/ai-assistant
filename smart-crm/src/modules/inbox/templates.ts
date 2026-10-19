/** Helpers for WhatsApp message templates (pure; shared by client and server). */
export type TemplateComponent = { type?: string; format?: string; text?: string };

function componentText(components: unknown, type: "HEADER" | "BODY" | "FOOTER"): string | null {
  if (!Array.isArray(components)) return null;
  const c = (components as TemplateComponent[]).find((x) => String(x?.type).toUpperCase() === type);
  if (!c || (type === "HEADER" && c.format && c.format !== "TEXT")) return null;
  return typeof c.text === "string" ? c.text : null;
}

/** Highest {{n}} placeholder in a text. */
export function placeholderCount(text: string | null): number {
  if (!text) return 0;
  let max = 0;
  for (const m of text.matchAll(/\{\{\s*(\d+)\s*\}\}/g)) max = Math.max(max, Number(m[1]));
  return max;
}

export function templateParts(components: unknown) {
  const header = componentText(components, "HEADER");
  const body = componentText(components, "BODY");
  const footer = componentText(components, "FOOTER");
  return { header, body, footer, headerParams: placeholderCount(header), bodyParams: placeholderCount(body) };
}

export function fillPlaceholders(text: string, params: string[]): string {
  return text.replace(/\{\{\s*(\d+)\s*\}\}/g, (_, n: string) => params[Number(n) - 1] ?? `{{${n}}}`);
}

/** Human-readable rendering of a template with its parameters (stored as the message body). */
export function renderTemplate(components: unknown, params: { header?: string[]; body?: string[] }): string {
  const { header, body, footer } = templateParts(components);
  return [header && fillPlaceholders(header, params.header ?? []), body && fillPlaceholders(body, params.body ?? []), footer]
    .filter(Boolean)
    .join("\n");
}
