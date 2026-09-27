import { trustItems } from "@/data/content";
import { Container } from "@/components/ui/Container";

/** Quiet hairline row of trust points. */
export function TrustStrip() {
  return (
    <section aria-label="למה אצלנו" className="border-y border-line">
      <Container>
        <ul className="grid grid-cols-2 lg:grid-cols-4">
          {trustItems.map((item, index) => (
            <li
              key={item.title}
              className={
                "flex flex-col gap-1.5 py-8 ps-0 pe-4 sm:py-10 lg:px-8 " +
                (index > 0 ? "lg:border-s lg:border-line " : "lg:ps-0 ") +
                (index % 2 === 1 ? "border-s border-line ps-4 lg:ps-8 " : "") +
                (index < 2 ? "border-b border-line lg:border-b-0" : "")
              }
            >
              <p className="font-display text-xl font-light text-ink">{item.title}</p>
              <p className="text-sm leading-snug text-muted">{item.description}</p>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
