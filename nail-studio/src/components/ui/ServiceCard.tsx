import { ArrowUpLeft, Brush, Droplets, Eraser, Gem, Layers, Palette, type LucideIcon } from "lucide-react";
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
    <article className="group relative flex h-full flex-col gap-8 overflow-hidden rounded-3xl border border-line bg-coal p-7 transition-[transform,border-color,background-color] duration-500 ease-[var(--ease-premium)] hover:-translate-y-1.5 hover:border-cherry hover:bg-cherry">
      <div className="flex items-start justify-between">
        <span className="grid h-14 w-14 place-items-center rounded-2xl bg-cherry text-night transition-colors duration-500 group-hover:bg-night group-hover:text-cherry">
          <Icon aria-hidden className="h-6 w-6" strokeWidth={1.8} />
        </span>
        <ArrowUpLeft
          aria-hidden
          className="h-6 w-6 text-mist transition-[color,transform] duration-500 group-hover:-translate-x-1 group-hover:-translate-y-1 group-hover:text-night"
          strokeWidth={1.8}
        />
      </div>
      <div className="flex flex-col gap-3">
        <h3 className="font-display text-5xl leading-none font-bold text-cream transition-colors duration-500 group-hover:text-night">
          {service.title}
        </h3>
        <p className="leading-relaxed text-mist transition-colors duration-500 group-hover:text-night/80">{service.description}</p>
      </div>
      <div className="mt-auto flex items-center justify-between gap-3 border-t border-line pt-4 text-sm transition-colors duration-500 group-hover:border-night/20">
        {service.price !== null ? (
          <span className="font-bold text-cream group-hover:text-night">{formatPrice(service.price)}</span>
        ) : (
          <span className="text-mist group-hover:text-night/80">{pricePending}</span>
        )}
        {service.duration && <span className="text-mist group-hover:text-night/80">{service.duration}</span>}
      </div>
    </article>
  );
}
