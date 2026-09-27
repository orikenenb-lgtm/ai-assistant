import Image from "next/image";
import { Star } from "lucide-react";
import type { Testimonial } from "@/types";

export function TestimonialCard({ testimonial, demoBadge }: { testimonial: Testimonial; demoBadge: string }) {
  const rating = Math.max(0, Math.min(5, Math.round(testimonial.rating)));
  return (
    <figure className="flex h-full flex-col gap-8 border-t border-line pt-8">
      <div className="flex items-center justify-between gap-4">
        <div role="img" aria-label={`דירוג ${rating} מתוך 5`} className="flex gap-1 text-orchid">
          {Array.from({ length: 5 }, (_, i) => (
            <Star key={i} aria-hidden className="h-3.5 w-3.5" strokeWidth={1.2} fill={i < rating ? "currentColor" : "none"} />
          ))}
        </div>
        {testimonial.isDemo && <span className="text-xs tracking-wide text-mist">{demoBadge}</span>}
      </div>

      <blockquote className="flex-1 font-display text-2xl leading-snug font-extralight text-cream">
        <p>״{testimonial.review}״</p>
      </blockquote>

      <figcaption className="flex items-center gap-3 text-sm text-mist">
        {testimonial.avatar && (
          <Image src={testimonial.avatar} alt="" width={36} height={36} className="h-9 w-9 rounded-full object-cover" />
        )}
        <span aria-hidden className="bg-iridescent h-px w-6" />
        {testimonial.name}
      </figcaption>
    </figure>
  );
}
