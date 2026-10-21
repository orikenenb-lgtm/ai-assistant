import { buildLocalBusinessSchema } from "@/lib/structured-data";

/** Emits LocalBusiness JSON-LD only when real business details are configured. */
export function LocalBusinessJsonLd() {
  const schema = buildLocalBusinessSchema();
  if (!schema) return null;
  return (
    <script
      type="application/ld+json"
      // Escape "<" so config values can never break out of the script tag.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema).replace(/</g, "\\u003c") }}
    />
  );
}
