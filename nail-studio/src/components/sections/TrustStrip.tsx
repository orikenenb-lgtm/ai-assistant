import { Asterisk } from "lucide-react";
import { trustItems } from "@/data/content";

/** Loud cherry marquee carrying the trust points. Screen readers get the plain list once. */
export function TrustStrip() {
  const words = trustItems.map((item) => item.title);
  const run = [...words, ...words];
  return (
    <section aria-label="למה אצלנו" className="relative overflow-hidden bg-cherry py-5 text-night sm:py-6">
      <ul className="sr-only">
        {trustItems.map((item) => (
          <li key={item.title}>
            {item.title} — {item.description}
          </li>
        ))}
      </ul>
      <div aria-hidden className="flex w-max animate-marquee">
        {[0, 1].map((copy) => (
          <div key={copy} className="flex shrink-0 items-center">
            {run.map((word, i) => (
              <span key={`${copy}-${i}`} className="flex items-center gap-6 px-6 font-display text-5xl leading-none font-bold whitespace-nowrap sm:text-6xl">
                {word}
                <Asterisk className="h-8 w-8" strokeWidth={2.5} />
              </span>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
