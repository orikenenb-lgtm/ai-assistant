import { brand, contact, plans } from "@/config/site";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { AccessibilityMenu } from "@/components/layout/AccessibilityMenu";
import { MobileCtaBar } from "@/components/layout/MobileCtaBar";
import { RevealObserver } from "@/components/ui/RevealObserver";
import { DetailsAnchorOpener } from "@/components/ui/DetailsAnchorOpener";
import { Hero } from "@/components/sections/Hero";
import { PainPoints } from "@/components/sections/PainPoints";
import { CallOutcome } from "@/components/sections/CallOutcome";
import { Research } from "@/components/sections/Research";
import { Package } from "@/components/sections/Package";
import { Industries } from "@/components/sections/Industries";
import { RoiCalculator } from "@/components/sections/RoiCalculator";
import { Integrations } from "@/components/sections/Integrations";
import { WhatsAppSection } from "@/components/sections/WhatsAppSection";
import { Dashboard } from "@/components/sections/Dashboard";
import { Process } from "@/components/sections/Process";
import { Pricing } from "@/components/sections/Pricing";
import { Faq } from "@/components/sections/Faq";
import { FinalCta } from "@/components/sections/FinalCta";

function StructuredData() {
  const data = [
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      name: brand.name,
      url: contact.siteUrl,
      logo: `${contact.siteUrl}/icon.svg`,
      ...(contact.email ? { email: contact.email } : {}),
    },
    {
      "@context": "https://schema.org",
      "@type": "Service",
      name: `${brand.name}: נציג טלפוני AI בעברית`,
      serviceType: "AI phone agent",
      description: brand.description,
      areaServed: { "@type": "Country", name: "Israel" },
      provider: { "@type": "Organization", name: brand.name, url: contact.siteUrl },
      offers: plans.map((p) => ({
        "@type": "Offer",
        name: p.name,
        price: p.price,
        priceCurrency: "ILS",
        description: `${p.minutes} דקות שיחה בחודש`,
        url: `${contact.siteUrl}/#pricing`,
      })),
    },
  ];
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }} />;
}

export default function HomePage() {
  return (
    <>
      <a
        href="#main"
        className="sr-only z-[60] rounded-full bg-brand px-4 py-2 font-semibold text-brand-ink focus:not-sr-only focus:fixed focus:start-4 focus:top-4"
      >
        דילוג לתוכן
      </a>
      <StructuredData />
      <Header />
      <main id="main">
        <Hero />
        <PainPoints />
        <CallOutcome />
        <Research />
        <Package />
        <Industries />
        <RoiCalculator />
        <Integrations />
        <WhatsAppSection />
        <Dashboard />
        <Process />
        <Pricing />
        <Faq />
        <FinalCta />
      </main>
      <Footer />
      <MobileCtaBar />
      <AccessibilityMenu />
      <RevealObserver />
      <DetailsAnchorOpener />
    </>
  );
}
