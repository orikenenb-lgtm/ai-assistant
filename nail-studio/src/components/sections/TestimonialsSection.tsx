import { MessageSquareHeart } from "lucide-react";
import { testimonials } from "@/data/testimonials";
import { sectionContent } from "@/data/content";
import { siteConfig } from "@/config/site";
import { SECTION_IDS } from "@/lib/links";
import { Container } from "@/components/ui/Container";
import { Reveal } from "@/components/ui/Reveal";
import { Section } from "@/components/ui/Section";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { TestimonialCard } from "@/components/ui/TestimonialCard";

export function TestimonialsSection() {
  const copy = sectionContent.testimonials;
  const visible = testimonials.filter((t) => !t.isDemo || siteConfig.features.showDemoTestimonials);

  return (
    <Section id={SECTION_IDS.testimonials} tone="cream" aria-labelledby="testimonials-title">
      <Container>
        <Reveal>
          <SectionHeading id="testimonials-title" eyebrow={copy.eyebrow} title={copy.title} description={copy.description} />
        </Reveal>
        {visible.length > 0 ? (
          <ul className="mt-12 grid gap-5 sm:mt-16 md:grid-cols-2 lg:grid-cols-3 lg:gap-6">
            {visible.map((testimonial, index) => (
              <Reveal as="li" key={testimonial.id} delay={index * 0.08}>
                <TestimonialCard testimonial={testimonial} demoBadge={copy.demoBadge} />
              </Reveal>
            ))}
          </ul>
        ) : (
          <div className="mx-auto mt-12 flex max-w-md flex-col items-center gap-4 rounded-2xl border border-dashed border-nude bg-ivory/60 px-6 py-14 text-center">
            <MessageSquareHeart aria-hidden className="h-8 w-8 text-rose-400" strokeWidth={1.4} />
            <p className="text-muted">{copy.description}</p>
          </div>
        )}
      </Container>
    </Section>
  );
}
