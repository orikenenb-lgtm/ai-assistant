import Image from "next/image";
import { Quote, Star } from "lucide-react";
import type { Testimonial } from "@/types";

export function TestimonialCard({ testimonial, demoBadge }: { testimonial: Testimonial; demoBadge: string }) {
  const rating = Math.max(0, Math.min(5, Math.round(testimonial.rating)));
  return (
    <figure className="relative flex h-full flex-col gap-6 rounded-2xl border border-line/80 bg-ivory p-7 shadow-soft">
      <div className="flex items-start justify-between gap-4">
        <Quote aria-hidden className="h-8 w-8 -scale-x-100 text-rose-300" strokeWidth={1.2} />
        {testimonial.isDemo && (
          <span className="rounded-full border border-dashed border-rose-400/70 px-3 py-1 text-xs font-medium text-rose-700">
            {demoBadge}
          </span>
        )}
      </div>

      <blockquote className="flex-1 text-lg leading-relaxed text-ink-soft">
        <p>{testimonial.review}</p>
      </blockquote>

      <figcaption className="flex items-center justify-between gap-4 border-t border-line/80 pt-5">
        <div className="flex items-center gap-3">
          {testimonial.avatar ? (
            <Image src={testimonial.avatar} alt="" width={40} height={40} className="h-10 w-10 rounded-full object-cover" />
          ) : (
            <span aria-hidden className="grid h-10 w-10 place-items-center rounded-full bg-blush font-display text-rose-700">
              {testimonial.name.charAt(0)}
            </span>
          )}
          <span className="font-medium text-ink">{testimonial.name}</span>
        </div>
        <div role="img" aria-label={`דירוג ${rating} מתוך 5`} className="flex gap-0.5 text-rose-400">
          {Array.from({ length: 5 }, (_, i) => (
            <Star key={i} aria-hidden className="h-4 w-4" strokeWidth={1.4} fill={i < rating ? "currentColor" : "none"} />
          ))}
        </div>
      </figcaption>
    </figure>
  );
}
