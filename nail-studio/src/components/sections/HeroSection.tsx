import { ArrowLeft } from "lucide-react";
import { heroContent } from "@/data/content";
import { SECTION_IDS, anchor, getBookingLink } from "@/lib/links";
import { Button } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { NailArt } from "@/components/ui/NailArt";

/** Server-rendered hero. Entrance motion is pure CSS so the LCP text never waits for JS. */
export function HeroSection() {
  const booking = getBookingLink();
  return (
    <section
      id={SECTION_IDS.home}
      aria-labelledby="hero-title"
      className="relative isolate overflow-hidden"
    >
      {/* Ambient background */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute top-16 start-[-10%] h-[520px] w-[520px] rounded-full bg-blush/70 blur-3xl" />
        <div className="absolute top-1/3 end-[-15%] h-[560px] w-[560px] rounded-full bg-cream blur-3xl" />
      </div>

      <Container className="grid items-center gap-14 pt-8 pb-20 sm:pt-12 lg:min-h-[calc(100svh-5rem)] lg:grid-cols-[1.05fr_1fr] lg:gap-10 lg:py-16">
        <div className="flex flex-col items-start gap-7">
          <p className="flex animate-rise items-center gap-3 text-sm font-medium tracking-[0.06em] text-rose-600">
            <span aria-hidden className="h-px w-10 bg-rose-400/70" />
            {heroContent.eyebrow}
          </p>
          <h1
            id="hero-title"
            className="animate-rise font-display text-[2.6rem] leading-[1.05] font-medium text-balance text-ink [animation-delay:80ms] min-[380px]:text-5xl sm:text-6xl lg:text-7xl"
          >
            {heroContent.headline}
          </h1>
          <p className="max-w-xl animate-rise text-lg leading-relaxed text-pretty text-muted [animation-delay:160ms] sm:text-xl">
            {heroContent.subheadline}
          </p>
          <div className="flex w-full animate-rise flex-col gap-3 [animation-delay:240ms] min-[420px]:w-auto min-[420px]:flex-row">
            <Button href={booking.href} external={booking.external} size="lg">
              {heroContent.primaryCta}
              <ArrowLeft aria-hidden className="h-4 w-4 transition-transform duration-300 group-hover:-translate-x-1" strokeWidth={1.8} />
            </Button>
            <Button href={anchor(SECTION_IDS.gallery)} variant="secondary" size="lg">
              {heroContent.secondaryCta}
            </Button>
          </div>
        </div>

        <HeroVisual />
      </Container>
    </section>
  );
}

function HeroVisual() {
  return (
    <div aria-hidden className="relative mx-auto aspect-[4/5] w-full max-w-[420px] animate-rise [animation-delay:200ms] sm:max-w-[460px] lg:max-w-[500px]">
      {/* Outline ring */}
      <div className="absolute -inset-4 rounded-t-full rounded-b-[2.5rem] border border-rose-300/40 sm:-inset-6" />

      {/* Main arch */}
      <div className="absolute inset-0 overflow-hidden rounded-t-full rounded-b-[2rem] shadow-lift">
        <NailArt tone="nude" composition="fan" />
      </div>

      {/* Floating swatch card */}
      <div className="absolute -bottom-6 start-[-4%] flex animate-float items-center gap-3 rounded-2xl border border-line/80 bg-ivory/90 px-4 py-3 shadow-lift backdrop-blur sm:start-[-10%]">
        <div className="flex -space-x-2 rtl:space-x-reverse">
          {["#c9a48e", "#b77f82", "#f0ddd6", "#7e5f53"].map((color) => (
            <span key={color} className="h-7 w-7 rounded-full border-2 border-ivory" style={{ background: color }} />
          ))}
        </div>
        <span className="text-xs font-medium tracking-wide text-ink-soft" dir="ltr">
          Nude · Rose · Ivory
        </span>
      </div>

      {/* Floating detail tile */}
      <div className="absolute -top-2 end-[-4%] hidden h-28 w-24 animate-float overflow-hidden rounded-2xl border-4 border-ivory shadow-lift [animation-delay:-4s] min-[400px]:block sm:end-[-10%] sm:h-36 sm:w-28">
        <NailArt tone="rose" composition="single" />
      </div>
    </div>
  );
}
