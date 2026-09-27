import Image from "next/image";
import { aboutContent } from "@/data/about";
import { sectionContent } from "@/data/content";
import { siteConfig } from "@/config/site";
import { SECTION_IDS } from "@/lib/links";
import { hasValue } from "@/lib/utils";
import { Container } from "@/components/ui/Container";
import { NailArt } from "@/components/ui/NailArt";
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
      <Container className="grid items-center gap-14 lg:grid-cols-2 lg:gap-20">
        <Reveal className="relative mx-auto w-full max-w-md lg:max-w-none">
          <div className="relative aspect-[4/5] overflow-hidden rounded-t-full rounded-b-[2rem] bg-sand shadow-lift">
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
                <NailArt tone="sand" composition="single" />
                <span className="absolute inset-x-0 bottom-8 text-center text-xs tracking-[0.06em] text-ink-soft/70">
                  מקום לתמונה
                </span>
              </>
            )}
          </div>
          <div aria-hidden className="absolute -bottom-5 -start-5 -z-10 h-2/3 w-2/3 rounded-[2rem] bg-blush" />
        </Reveal>

        <Reveal delay={0.1} className="flex flex-col gap-6">
          <SectionHeading id="about-title" eyebrow={copy.eyebrow} title={aboutContent.heading} align="start" />
          {ownerName && <p className="font-display text-2xl text-rose-700">{ownerName}</p>}
          <div className="flex flex-col gap-4 text-lg leading-relaxed text-muted">
            {paragraphs.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </div>
          {hasValue(experience) && <p className="text-ink-soft">{experience}</p>}
          <blockquote className="border-s-2 border-rose-300 ps-5 font-display text-xl leading-relaxed text-ink-soft sm:text-2xl">
            {hasValue(philosophy) ? philosophy : copy.placeholderPhilosophy}
          </blockquote>
        </Reveal>
      </Container>
    </Section>
  );
}
