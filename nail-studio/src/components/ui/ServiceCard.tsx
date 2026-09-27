import type { Service } from "@/types";
import { formatPrice } from "@/lib/utils";

/** One row of the service list: editorial, hairline-divided, no icons. */
export function ServiceCard({ service, pricePending }: { service: Service; pricePending: string }) {
  return (
    <article className="group relative grid gap-3 py-8 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] sm:items-baseline sm:gap-10 sm:py-10">
      {/* Iridescent hairline that draws in on hover */}
      <span aria-hidden className="bg-iridescent absolute inset-x-0 bottom-[-1px] h-px origin-right scale-x-0 transition-transform duration-700 ease-[var(--ease-premium)] group-hover:scale-x-100" />
      <h3 className="font-display text-3xl font-light text-ink transition-colors duration-500 sm:text-4xl">{service.title}</h3>
      <p className="max-w-lg leading-relaxed text-muted">{service.description}</p>
      <p className="text-sm tracking-wide text-muted sm:text-end">
        {service.price !== null ? <span className="text-ink">{formatPrice(service.price)}</span> : pricePending}
        {service.duration && <span className="ms-3">{service.duration}</span>}
      </p>
    </article>
  );
}
