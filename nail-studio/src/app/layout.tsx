import type { ReactNode } from "react";
import type { Metadata, Viewport } from "next";
import { Frank_Ruhl_Libre, Heebo } from "next/font/google";
import { siteConfig, brandName } from "@/config/site";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { MotionProvider } from "@/components/providers/MotionProvider";
import { LocalBusinessJsonLd } from "@/components/JsonLd";
import "./globals.css";

const heading = Frank_Ruhl_Libre({
  variable: "--font-heading",
  subsets: ["hebrew", "latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

const body = Heebo({
  variable: "--font-body",
  subsets: ["hebrew", "latin"],
  display: "swap",
});

const indexable = siteConfig.seo.allowIndexing;

export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.url),
  title: {
    default: `${brandName} | סטודיו לציפורניים`,
    template: `%s | ${brandName}`,
  },
  description: siteConfig.description,
  applicationName: brandName,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    locale: siteConfig.locale,
    url: "/",
    siteName: brandName,
    title: `${brandName} | סטודיו לציפורניים`,
    description: siteConfig.description,
  },
  twitter: {
    card: "summary_large_image",
    title: `${brandName} | סטודיו לציפורניים`,
    description: siteConfig.description,
  },
  // Placeholder content must not be indexed. Flip NEXT_PUBLIC_ALLOW_INDEXING=true at launch.
  robots: indexable ? { index: true, follow: true } : { index: false, follow: false },
  formatDetection: { telephone: false, address: false, email: false },
};

export const viewport: Viewport = {
  themeColor: "#fbf8f4",
  colorScheme: "light",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang={siteConfig.lang} dir={siteConfig.dir} className={`${heading.variable} ${body.variable}`}>
      <body className="flex min-h-svh flex-col">
        <a
          href="#main"
          className="sr-only rounded-full bg-ink px-5 py-3 text-sm text-ivory focus:not-sr-only focus:fixed focus:top-3 focus:start-3 focus:z-[60]"
        >
          דילוג לתוכן הראשי
        </a>
        <MotionProvider>
          <Header />
          <main id="main" tabIndex={-1} className="flex-1 outline-none">
            {children}
          </main>
          <Footer />
        </MotionProvider>
        <LocalBusinessJsonLd />
      </body>
    </html>
  );
}
