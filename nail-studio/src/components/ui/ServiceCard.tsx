import { Brush, Droplets, Eraser, Gem, Layers, Palette, type LucideIcon } from "lucide-react";
import type { Service, ServiceIconName } from "@/types";
import { formatPrice } from "@/lib/utils";

const icons: Record<ServiceIconName, LucideIcon> = {
  gel: Droplets,
  build: Layers,
  fill: Gem,
  french: Brush,
  art: Palette,
  removal: Eraser,
};

export function ServiceCard({ service, pricePending }: { service: Service; pricePending: string }) {
  const Icon = icons[service.icon];
  return (
    <article className="group relative flex h-full flex-col gap-5 rounded-2xl border border-line/80 bg-ivory p-7 shadow-soft transition-[transform,box-shadow,border-color] duration-500 ease-[var(--ease-premium)] hover:-translate-y-1 hover:border-rose-200 hover:shadow-lift">
      <span className="grid h-12 w-12 place-items-center rounded-full bg-blush text-rose-600 transition-colors duration-500 group-hover:bg-rose-600 group-hover:text-ivory">
        <Icon aria-hidden className="h-5 w-5" strokeWidth={1.6} />
      </span>
      <div className="flex flex-col gap-2">
        <h3 className="font-display text-2xl font-medium text-ink">
          {service.title}
        </h3>
        <p className="leading-relaxed text-muted">{service.description}</p>
      </div>
      <div className="mt-auto flex items-center justify-between gap-3 border-t border-line/80 pt-4 text-sm">
        {service.price !== null ? (
          <span className="font-medium text-ink">{formatPrice(service.price)}</span>
        ) : (
          <span className="text-muted">{pricePending}</span>
        )}
        {service.duration && <span className="text-muted">{service.duration}</span>}
      </div>
    </article>
  );
}
