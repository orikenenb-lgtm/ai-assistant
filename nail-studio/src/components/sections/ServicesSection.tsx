import { services } from "@/data/services";
import { sectionContent } from "@/data/content";
import { SECTION_IDS } from "@/lib/links";
import { Container } from "@/components/ui/Container";
import { Reveal } from "@/components/ui/Reveal";
import { Section } from "@/components/ui/Section";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { ServiceCard } from "@/components/ui/ServiceCard";

export function ServicesSection() {
  const copy = sectionContent.services;
  return (
    <Section id={SECTION_IDS.services} aria-labelledby="services-title">
      <Container>
        <Reveal>
          <SectionHeading id="services-title" eyebrow={copy.eyebrow} title={copy.title} description={copy.description} />
        </Reveal>

        {/* Mobile: swipeable row with snap. sm+: grid. */}
        <ul
          aria-label="רשימת טיפולים"
          tabIndex={0}
          className="-mx-5 mt-12 flex snap-x snap-mandatory scroll-px-5 gap-4 overflow-x-auto px-5 pt-2 pb-6 [scrollbar-width:none] sm:mx-0 sm:mt-16 sm:grid sm:grid-cols-2 sm:gap-6 sm:overflow-visible sm:px-0 sm:pb-0 lg:grid-cols-3 [&::-webkit-scrollbar]:hidden"
        >
          {services.map((service, index) => (
            <Reveal as="li" key={service.id} delay={(index % 3) * 0.08} className="w-[80%] max-w-[340px] shrink-0 snap-start sm:w-auto sm:max-w-none">
              <ServiceCard service={service} pricePending={copy.pricePending} />
            </Reveal>
          ))}
        </ul>
        <p aria-hidden className="mt-1 text-center text-xs text-muted sm:hidden">החליקי לצפייה בכל הטיפולים ←</p>
      </Container>
    </Section>
  );
}
