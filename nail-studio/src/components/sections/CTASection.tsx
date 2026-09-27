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
    <section id={SECTION_IDS.booking} aria-labelledby="cta-title" className="bg-ivory py-20 sm:py-24">
      <Container>
        <Reveal>
          <div className="relative isolate overflow-hidden rounded-[2rem] bg-ink px-6 py-16 text-center sm:px-12 sm:py-20 lg:py-24">
            <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
              <div className="absolute -top-24 start-1/4 h-72 w-72 rounded-full bg-rose-400/25 blur-3xl" />
              <div className="absolute -bottom-32 end-1/4 h-80 w-80 rounded-full bg-nude/20 blur-3xl" />
              <div className="absolute inset-4 rounded-[1.5rem] border border-ivory/10 sm:inset-6" />
            </div>
            <h2 id="cta-title" className="mx-auto max-w-2xl font-display text-4xl leading-tight font-medium text-balance text-ivory sm:text-5xl lg:text-6xl">
              {copy.title}
            </h2>
            <p className="mx-auto mt-5 max-w-xl text-lg leading-relaxed text-pretty text-ivory/80">{copy.description}</p>
            <div className="mt-10 flex flex-col items-stretch justify-center gap-3 min-[420px]:flex-row min-[420px]:items-center">
              <Button href={booking.href} external={booking.external} variant="light" size="lg">
                {copy.primary}
                <ArrowLeft aria-hidden className="h-4 w-4 transition-transform duration-300 group-hover:-translate-x-1" strokeWidth={1.8} />
              </Button>
              <Button href={anchor(SECTION_IDS.contact)} variant="outline-light" size="lg">
                {copy.secondary}
              </Button>
            </div>
          </div>
        </Reveal>
      </Container>
    </section>
  );
}
