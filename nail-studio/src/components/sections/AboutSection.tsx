import Image from "next/image";
import { aboutContent } from "@/data/about";
import { sectionContent } from "@/data/content";
import { siteConfig } from "@/config/site";
import { SECTION_IDS } from "@/lib/links";
import { hasValue } from "@/lib/utils";
import { Aura } from "@/components/ui/Aura";
import { Container } from "@/components/ui/Container";
import { Reveal } from "@/components/ui/Reveal";
import { Section } from "@/components/ui/Section";
import { SectionHeading } from "@/components/ui/SectionHeading";

export function AboutSection() {
  const copy = sectionContent.about;
  const { ownerImage, biography, experience, philosophy } = aboutContent;
  const ownerName = hasValue(siteConfig.owner) ? siteConfig.owner : null;
  const paragraphs = biography.length > 0 ? biography : [copy.placeholderBio];

  return (
    <Section id={SECTION_IDS.about} aria-labelledby="about-title">
      <Container className="grid items-center gap-16 lg:grid-cols-[1fr_1.1fr] lg:gap-24">
        <Reveal className="relative mx-auto w-full max-w-md lg:max-w-none">
          <div className="relative aspect-[4/5] overflow-hidden rounded-[2rem] border border-line bg-coal">
            {ownerImage ? (
              <Image
                src={ownerImage.src}
                alt={ownerName ? `${ownerName}, בעלת הסטודיו` : "בעלת הסטודיו"}
                fill
                sizes="(min-width: 1024px) 40vw, 90vw"
                className="object-cover"
              />
            ) : (
              <>
                <Aura tone="dusk" />
                <span className="absolute inset-x-0 bottom-6 text-center text-sm text-cream/70">מקום לתמונה</span>
              </>
            )}
          </div>
        </Reveal>

        <Reveal delay={0.1} className="flex flex-col gap-8">
          <SectionHeading id="about-title" eyebrow={copy.eyebrow} title={aboutContent.heading} highlight="עליי" />
          {ownerName && <p className="font-display text-3xl font-light text-iridescent">{ownerName}</p>}
          <div className="flex flex-col gap-4 text-lg leading-relaxed text-mist">
            {paragraphs.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </div>
          {hasValue(experience) && <p className="text-cream">{experience}</p>}
          <blockquote className="border-s border-line ps-6 font-display text-3xl leading-snug font-extralight text-cream">
            {hasValue(philosophy) ? philosophy : copy.placeholderPhilosophy}
          </blockquote>
        </Reveal>
      </Container>
    </Section>
  );
}
