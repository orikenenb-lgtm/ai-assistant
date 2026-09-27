import Image from "next/image";
import { aboutContent } from "@/data/about";
import { sectionContent } from "@/data/content";
import { siteConfig } from "@/config/site";
import { SECTION_IDS } from "@/lib/links";
import { hasValue } from "@/lib/utils";
import { Container } from "@/components/ui/Container";
import { Lacquer } from "@/components/ui/Lacquer";
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
      <Container className="grid items-center gap-16 lg:grid-cols-2 lg:gap-20">
        <Reveal className="relative mx-auto w-full max-w-md lg:max-w-none">
          {/* Cherry offset block behind the portrait */}
          <div aria-hidden className="absolute inset-0 translate-x-[-5%] translate-y-[5%] rounded-3xl bg-cherry" />
          <div className="relative aspect-[4/5] overflow-hidden rounded-3xl bg-coal">
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
                <Lacquer tone="noir" />
                <span className="absolute inset-x-0 bottom-6 text-center text-sm font-bold text-mist">מקום לתמונה</span>
              </>
            )}
          </div>
        </Reveal>

        <Reveal delay={0.1} className="flex flex-col gap-7">
          <SectionHeading id="about-title" eyebrow={copy.eyebrow} title={aboutContent.heading} highlight="עליי" />
          {ownerName && <p className="font-display text-4xl font-bold text-gold">{ownerName}</p>}
          <div className="flex flex-col gap-4 text-lg leading-relaxed text-mist">
            {paragraphs.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </div>
          {hasValue(experience) && <p className="text-cream">{experience}</p>}
          <blockquote className="border-s-4 border-cherry ps-5 font-display text-4xl leading-tight font-bold text-cream">
            {hasValue(philosophy) ? philosophy : copy.placeholderPhilosophy}
          </blockquote>
        </Reveal>
      </Container>
    </Section>
  );
}
