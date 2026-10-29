import type { MetadataRoute } from "next";
import { contact } from "@/config/site";

export default function sitemap(): MetadataRoute.Sitemap {
  const pages = [
    { path: "", priority: 1 },
    { path: "/privacy", priority: 0.3 },
    { path: "/terms", priority: 0.3 },
    { path: "/accessibility", priority: 0.3 },
  ];
  return pages.map((p) => ({
    url: `${contact.siteUrl}${p.path || "/"}`,
    changeFrequency: "monthly",
    priority: p.priority,
  }));
}
