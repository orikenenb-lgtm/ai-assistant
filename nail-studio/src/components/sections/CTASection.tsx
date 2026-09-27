import { ArrowLeft } from "lucide-react";
import { sectionContent } from "@/data/content";
import { SECTION_IDS, anchor, getBookingLink } from "@/lib/links";
import { Button } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { Reveal } from "@/components/ui/Reveal";

export function CTASection() {
  const copy = sectionContent.cta;
  const booking = getBookingLink();
  return (
    <section id={SECTION_IDS.booking} aria-labelledby="cta-title" className="relative isolate overflow-hidden border-y border-line bg-coal">
      {/* One large, slow iridescent glow — the page's single loud moment */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute top-1/2 left-1/2 h-[80vmax] w-[80vmax] -translate-x-1/2 -translate-y-1/2 animate-aura rounded-full bg-[conic-gradient(from_90deg,rgb(233_139_196/0.34),rgb(233_139_196/0.26),rgb(155_123_255/0.2),rgb(143_211_244/0.14),rgb(233_139_196/0.34))] blur-3xl" />
      </div>
      <Container size="narrow" className="py-24 text-center sm:py-32 lg:py-40">
        <Reveal className="flex flex-col items-center gap-8">
          <h2 id="cta-title" className="font-display text-5xl leading-[1.05] font-extralight text-balance text-cream sm:text-7xl">
            {copy.title}
          </h2>
          <p className="max-w-lg text-lg leading-relaxed text-pretty text-mist">{copy.description}</p>
          <div className="flex w-full flex-col items-stretch justify-center gap-3 min-[440px]:w-auto min-[440px]:flex-row">
            <Button href={booking.href} external={booking.external} size="lg">
              {copy.primary}
              <ArrowLeft aria-hidden className="h-4 w-4 transition-transform duration-500 group-hover:-translate-x-1" strokeWidth={1.4} />
            </Button>
            <Button href={anchor(SECTION_IDS.contact)} variant="secondary" size="lg">
              {copy.secondary}
            </Button>
          </div>
        </Reveal>
      </Container>
    </section>
  );
}
