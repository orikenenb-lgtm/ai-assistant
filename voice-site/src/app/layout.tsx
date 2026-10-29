import type { Metadata, Viewport } from "next";
import "@fontsource-variable/heebo";
import "./globals.css";
import { brand, contact } from "@/config/site";

const title = `${brand.name} · נציג טלפוני AI בעברית שעונה, קובע ומעדכן`;

export const metadata: Metadata = {
  metadataBase: new URL(contact.siteUrl),
  title: { default: title, template: `%s | ${brand.name}` },
  description: brand.description,
  applicationName: brand.name,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    locale: "he_IL",
    url: "/",
    siteName: brand.name,
    title,
    description: brand.description,
    images: [{ url: "/og.png", width: 1200, height: 630, alt: `${brand.name}: נציג טלפוני AI בעברית` }],
  },
  twitter: { card: "summary_large_image", title, description: brand.description, images: ["/og.png"] },
  robots: { index: true, follow: true },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f5f0" },
    { media: "(prefers-color-scheme: dark)", color: "#0c130f" },
  ],
  colorScheme: "light dark",
};

/**
 * Runs before first paint: applies the saved/system theme and accessibility
 * preferences, and marks the document as JS-enabled (enables scroll reveals).
 */
const bootScript = `(function(){var d=document.documentElement;d.classList.add("js");try{var t=localStorage.getItem("theme");if(t!=="light"&&t!=="dark"){t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}d.setAttribute("data-theme",t);var a=JSON.parse(localStorage.getItem("a11y")||"{}");if(a.scale)d.style.setProperty("--font-scale",String(a.scale));if(a.contrast)d.setAttribute("data-a11y-contrast","high");if(a.motion)d.setAttribute("data-a11y-motion","off");if(a.links)d.setAttribute("data-a11y-links","on")}catch(e){}})()`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl" data-theme="light" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: bootScript }} />
      </head>
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
