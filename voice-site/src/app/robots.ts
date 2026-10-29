import type { MetadataRoute } from "next";
import { contact } from "@/config/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/", "/thanks", "/contact-error"] }],
    sitemap: `${contact.siteUrl}/sitemap.xml`,
    host: contact.siteUrl,
  };
}
