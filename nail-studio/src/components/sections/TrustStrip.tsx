import { trustItems } from "@/data/content";
import { Container } from "@/components/ui/Container";
import { Reveal } from "@/components/ui/Reveal";

export function TrustStrip() {
  return (
    <section aria-label="למה אצלנו" className="border-y border-line/70 bg-cream/60">
      <Container>
        <ul className="grid grid-cols-2 gap-x-6 gap-y-8 py-10 sm:py-12 lg:grid-cols-4">
          {trustItems.map(({ title, description, icon: Icon }, index) => (
            <Reveal as="li" key={title} delay={index * 0.06} className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:gap-4">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-rose-300/50 text-rose-600">
                <Icon aria-hidden className="h-5 w-5" strokeWidth={1.5} />
              </span>
              <div>
                <p className="font-medium text-ink">{title}</p>
                <p className="mt-0.5 text-sm leading-snug text-muted">{description}</p>
              </div>
            </Reveal>
          ))}
        </ul>
      </Container>
    </section>
  );
}
