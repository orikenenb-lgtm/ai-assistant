import Image from "next/image";
import { Star } from "lucide-react";
import type { Testimonial } from "@/types";

export function TestimonialCard({ testimonial, demoBadge }: { testimonial: Testimonial; demoBadge: string }) {
  const rating = Math.max(0, Math.min(5, Math.round(testimonial.rating)));
  return (
    <figure className="relative flex h-full flex-col gap-6 rounded-3xl border border-line bg-night p-7">
      <div className="flex items-start justify-between gap-4">
        <div role="img" aria-label={`דירוג ${rating} מתוך 5`} className="flex gap-1 text-cherry">
          {Array.from({ length: 5 }, (_, i) => (
            <Star key={i} aria-hidden className="h-5 w-5" strokeWidth={1.5} fill={i < rating ? "currentColor" : "none"} />
          ))}
        </div>
        {testimonial.isDemo && (
          <span className="rounded-full border border-dashed border-gold/60 px-3 py-1 text-xs font-bold text-gold">{demoBadge}</span>
        )}
      </div>

      <blockquote className="flex-1 text-xl leading-relaxed text-cream">
        <p>{testimonial.review}</p>
      </blockquote>

      <figcaption className="flex items-center gap-3 border-t border-line pt-5">
        {testimonial.avatar ? (
          <Image src={testimonial.avatar} alt="" width={44} height={44} className="h-11 w-11 rounded-full object-cover" />
        ) : (
          <span aria-hidden className="grid h-11 w-11 place-items-center rounded-full bg-cherry font-display text-2xl font-bold text-night">
            {testimonial.name.charAt(0)}
          </span>
        )}
        <span className="font-bold text-cream">{testimonial.name}</span>
      </figcaption>
    </figure>
  );
}
