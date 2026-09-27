import { ArrowLeft } from "lucide-react";
import { sectionContent } from "@/data/content";
import { SECTION_IDS, anchor, getBookingLink } from "@/lib/links";
import { Button } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { Reveal } from "@/components/ui/Reveal";

/** Full-bleed cherry block — the loudest moment on the page. */
export function CTASection() {
  const copy = sectionContent.cta;
  const booking = getBookingLink();
  return (
    <section id={SECTION_IDS.booking} aria-labelledby="cta-title" className="grain relative overflow-hidden bg-cherry text-night">
      <div aria-hidden className="pointer-events-none absolute -end-24 -top-24 h-96 w-96 rounded-full bg-[radial-gradient(closest-side,rgb(255_255_255/0.35),transparent)]" />
      <Container className="relative py-20 sm:py-28 lg:py-32">
        <Reveal className="flex flex-col items-start gap-8">
          <h2 id="cta-title" className="max-w-4xl font-display text-7xl leading-[0.85] font-bold text-balance sm:text-8xl lg:text-[10rem]">
            {copy.title}
          </h2>
          <p className="max-w-xl text-xl leading-relaxed font-medium text-pretty text-night/80">{copy.description}</p>
          <div className="flex w-full flex-col gap-3 min-[440px]:w-auto min-[440px]:flex-row">
            <Button href={booking.href} external={booking.external} variant="dark" size="lg">
              {copy.primary}
              <ArrowLeft aria-hidden className="h-5 w-5 transition-transform duration-300 group-hover:-translate-x-1" strokeWidth={2.2} />
            </Button>
            <Button href={anchor(SECTION_IDS.contact)} variant="outline-dark" size="lg">
              {copy.secondary}
            </Button>
          </div>
        </Reveal>
      </Container>
    </section>
  );
}
