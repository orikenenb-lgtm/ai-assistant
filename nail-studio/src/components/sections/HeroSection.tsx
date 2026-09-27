import { ArrowLeft } from "lucide-react";
import { heroContent } from "@/data/content";
import { SECTION_IDS, anchor, getBookingLink } from "@/lib/links";
import { Aura } from "@/components/ui/Aura";
import { Button } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";

/** Server-rendered hero. Entrance motion is pure CSS so the LCP text never waits for JS. */
export function HeroSection() {
  const booking = getBookingLink();
  const [before, after] = heroContent.headline.split(heroContent.highlight);

  return (
    <section id={SECTION_IDS.home} aria-labelledby="hero-title" className="relative isolate overflow-hidden">
      {/* Ambient iridescent light */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute top-[-25%] end-[-15%] h-[60vmax] w-[60vmax] rounded-full bg-[radial-gradient(closest-side,rgb(155_123_255/0.22),transparent)]" />
        <div className="absolute top-[20%] start-[-25%] h-[50vmax] w-[50vmax] rounded-full bg-[radial-gradient(closest-side,rgb(143_211_244/0.12),transparent)]" />
        <div className="absolute bottom-[-30%] end-[20%] h-[45vmax] w-[45vmax] rounded-full bg-[radial-gradient(closest-side,rgb(233_139_196/0.12),transparent)]" />
      </div>

      <Container className="grid items-center gap-16 pt-12 pb-20 sm:pt-16 lg:grid-cols-[1.2fr_1fr] lg:gap-20 lg:pt-20 lg:pb-32">
        <div className="flex flex-col items-start gap-8">
          <p className="flex animate-rise items-center gap-4 text-sm tracking-wide text-mist">
            <span aria-hidden className="bg-iridescent h-px w-10" />
            {heroContent.eyebrow}
          </p>
          <h1
            id="hero-title"
            className="animate-rise font-display text-[3.1rem] leading-[1.02] font-extralight text-balance text-cream [animation-delay:100ms] min-[400px]:text-6xl sm:text-7xl lg:text-8xl"
          >
            {before}
            <span className="text-iridescent">{heroContent.highlight}</span>
            {after}
          </h1>
          <p className="max-w-md animate-rise text-lg leading-relaxed text-pretty text-mist [animation-delay:200ms]">
            {heroContent.subheadline}
          </p>
          <div className="flex w-full animate-rise flex-col gap-3 [animation-delay:300ms] min-[440px]:w-auto min-[440px]:flex-row">
            <Button href={booking.href} external={booking.external} size="lg">
              {heroContent.primaryCta}
              <ArrowLeft aria-hidden className="h-4 w-4 transition-transform duration-500 group-hover:-translate-x-1" strokeWidth={1.4} />
            </Button>
            <Button href={anchor(SECTION_IDS.gallery)} variant="secondary" size="lg">
              {heroContent.secondaryCta}
            </Button>
          </div>
        </div>

        <figure className="relative mx-auto w-full max-w-[420px] animate-rise [animation-delay:250ms] lg:max-w-none">
          <div className="relative aspect-[4/5] overflow-hidden rounded-[2rem] border border-line shadow-lift">
            <Aura tone="aura" animated />
          </div>
          <figcaption className="mt-5 flex items-center justify-between text-sm text-mist">
            <span dir="ltr" className="text-xs tracking-[0.18em]">AURA CHROME</span>
            <span>גוונים: סגול · ורוד · תכלת</span>
          </figcaption>
        </figure>
      </Container>
    </section>
  );
}
