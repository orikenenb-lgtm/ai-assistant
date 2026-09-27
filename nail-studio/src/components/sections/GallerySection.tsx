import { ImageOff } from "lucide-react";
import { galleryItems } from "@/data/gallery";
import { sectionContent } from "@/data/content";
import { SECTION_IDS } from "@/lib/links";
import { Container } from "@/components/ui/Container";
import { Reveal } from "@/components/ui/Reveal";
import { Section } from "@/components/ui/Section";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { GalleryGrid } from "@/components/sections/GalleryGrid";

export function GallerySection() {
  const copy = sectionContent.gallery;
  return (
    <Section id={SECTION_IDS.gallery} aria-labelledby="gallery-title">
      <Container>
        <Reveal>
          <SectionHeading id="gallery-title" eyebrow={copy.eyebrow} title={copy.title} highlight={copy.highlight} description={copy.description} />
        </Reveal>
        <div className="mt-12 sm:mt-16">
          {galleryItems.length > 0 ? (
            <GalleryGrid items={galleryItems} />
          ) : (
            <div className="mx-auto flex max-w-md flex-col items-center gap-4 rounded-2xl border border-line bg-night px-6 py-16 text-center">
              <ImageOff aria-hidden className="h-8 w-8 text-violet" strokeWidth={1.4} />
              <p className="text-mist">{copy.empty}</p>
            </div>
          )}
        </div>
      </Container>
    </Section>
  );
}
