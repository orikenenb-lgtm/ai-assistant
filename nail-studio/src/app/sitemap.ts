import type { MetadataRoute } from "next";
import { siteConfig } from "@/config/site";

/** Add future routes (e.g. /prices, /gallery) to this list. */
const routes = ["/"] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  return routes.map((route) => ({
    url: new URL(route, siteConfig.url).toString(),
    changeFrequency: "monthly",
    priority: route === "/" ? 1 : 0.7,
  }));
}
