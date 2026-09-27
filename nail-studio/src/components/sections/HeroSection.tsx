import { ArrowLeft } from "lucide-react";
import { heroContent } from "@/data/content";
import { SECTION_IDS, anchor, getBookingLink } from "@/lib/links";
import { Button } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { Lacquer } from "@/components/ui/Lacquer";

/** Server-rendered hero. Entrance motion is pure CSS so the LCP text never waits for JS. */
export function HeroSection() {
  const booking = getBookingLink();
  const [before, after] = heroContent.headline.split(heroContent.highlight);

  return (
    <section id={SECTION_IDS.home} aria-labelledby="hero-title" className="grain relative isolate overflow-hidden">
      {/* Cherry glow */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute top-[-20%] end-[-25%] h-[70vmax] w-[70vmax] rounded-full bg-[radial-gradient(closest-side,rgb(255_42_95/0.35),transparent)]" />
        <div className="absolute bottom-[-30%] start-[-20%] h-[50vmax] w-[50vmax] rounded-full bg-[radial-gradient(closest-side,rgb(242_196_109/0.12),transparent)]" />
      </div>

      <Container className="grid items-center gap-14 pt-10 pb-20 sm:pt-14 lg:grid-cols-[1.25fr_1fr] lg:gap-8 lg:pt-16 lg:pb-28">
        <div className="flex flex-col items-start gap-7">
          <p className="flex animate-rise items-center gap-3 text-sm font-bold text-gold">
            <span aria-hidden className="h-2 w-2 rotate-45 bg-gold" />
            {heroContent.eyebrow}
          </p>
          <h1
            id="hero-title"
            className="animate-rise font-display text-[5.2rem] leading-[0.82] font-bold text-balance text-cream [animation-delay:80ms] min-[400px]:text-[6.2rem] sm:text-[8rem] lg:text-[9.5rem] xl:text-[11rem]"
          >
            {before}
            <span className="text-cherry">{heroContent.highlight}</span>
            {after}
          </h1>
          <p className="max-w-lg animate-rise text-lg leading-relaxed text-pretty text-mist [animation-delay:160ms] sm:text-xl">
            {heroContent.subheadline}
          </p>
          <div className="flex w-full animate-rise flex-col gap-3 [animation-delay:240ms] min-[440px]:w-auto min-[440px]:flex-row">
            <Button href={booking.href} external={booking.external} size="lg">
              {heroContent.primaryCta}
              <ArrowLeft aria-hidden className="h-5 w-5 transition-transform duration-300 group-hover:-translate-x-1" strokeWidth={2.2} />
            </Button>
            <Button href={anchor(SECTION_IDS.gallery)} variant="secondary" size="lg">
              {heroContent.secondaryCta}
            </Button>
          </div>
        </div>

        <HeroVisual badge={heroContent.badge} bookingHref={booking.href} bookingExternal={booking.external} />
      </Container>
    </section>
  );
}

function HeroVisual({ badge, bookingHref, bookingExternal }: { badge: string; bookingHref: string; bookingExternal: boolean }) {
  return (
    <div className="relative mx-auto aspect-square w-full max-w-[440px] animate-rise [animation-delay:200ms] lg:max-w-[520px]">
      {/* The big polish drop */}
      <div aria-hidden className="absolute inset-[6%] overflow-hidden rounded-full shadow-[0_40px_120px_-30px_rgb(255_42_95/0.7)]">
        <Lacquer tone="cherry" />
      </div>

      {/* Stacked swatches */}
      <div aria-hidden className="absolute bottom-[4%] start-[-2%] h-[30%] w-[30%] overflow-hidden rounded-full border-4 border-night">
        <Lacquer tone="gold" />
      </div>
      <div aria-hidden className="absolute bottom-[-2%] start-[20%] h-[22%] w-[22%] overflow-hidden rounded-full border-4 border-night">
        <Lacquer tone="noir" />
      </div>

      {/* Rotating booking badge */}
      <a
        href={bookingHref}
        {...(bookingExternal ? { target: "_blank", rel: "noopener noreferrer" } : {})}
        aria-label="קביעת תור"
        className="group absolute top-[-2%] end-[-2%] grid h-[34%] w-[34%] place-items-center rounded-full bg-night"
      >
        <svg viewBox="0 0 100 100" aria-hidden direction="ltr" className="absolute inset-0 h-full w-full animate-spin-slow">
          <defs>
            <path id="badge-circle" d="M50,50 m-38,0 a38,38 0 1,1 76,0 a38,38 0 1,1 -76,0" />
          </defs>
          <text fill="#f2c46d" fontSize="8.6" fontWeight="700" direction="ltr" unicodeBidi="plaintext" style={{ fontFamily: "var(--font-sans)" }}>
            <textPath href="#badge-circle" textLength="236" lengthAdjust="spacing">{badge + badge}</textPath>
          </text>
        </svg>
        <span className="grid h-[42%] w-[42%] place-items-center rounded-full bg-cherry text-night transition-transform duration-500 group-hover:scale-110">
          <ArrowLeft aria-hidden className="h-1/2 w-1/2" strokeWidth={2.4} />
        </span>
      </a>
    </div>
  );
}
