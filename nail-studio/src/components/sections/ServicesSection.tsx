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
          <SectionHeading id="services-title" eyebrow={copy.eyebrow} title={copy.title} highlight={copy.highlight} description={copy.description} />
        </Reveal>
        <ul className="mt-14 divide-y divide-line border-y border-line sm:mt-20">
          {services.map((service, index) => (
            <Reveal as="li" key={service.id} delay={index * 0.05}>
              <ServiceCard service={service} pricePending={copy.pricePending} />
            </Reveal>
          ))}
        </ul>
      </Container>
    </Section>
  );
}
