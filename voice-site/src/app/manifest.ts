import type { MetadataRoute } from "next";
import { brand } from "@/config/site";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: brand.name,
    short_name: brand.name,
    description: brand.description,
    lang: "he",
    dir: "rtl",
    start_url: "/",
    display: "browser",
    background_color: "#f6f5f0",
    theme_color: "#12221a",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png" },
    ],
  };
}
