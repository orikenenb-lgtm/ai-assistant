import { Plus } from "lucide-react";
import { faqs } from "@/content/faq";
import { SectionHeading } from "@/components/ui/Section";

export function Faq() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };

  return (
    <section id="faq" aria-labelledby="faq-title" className="container-page scroll-mt-24 py-20 sm:py-28">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <SectionHeading
        id="faq-title"
        eyebrow="שאלות נפוצות"
        title="שאלות לפני שמתחילים."
        lead="תשובות קצרות על נציג טלפוני AI לעסק: מחיר, שיחות נכנסות ויוצאות, חיבורים, פרטיות וביטול."
      />
      <div className="mt-10 divide-y divide-line border-y border-line" data-reveal>
        {faqs.map((f, i) => (
          <details key={f.q} className="group" name="faq" open={i === 0}>
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-5 text-start text-lg font-semibold transition-colors hover:text-brand [&::-webkit-details-marker]:hidden">
              {f.q}
              <span className="grid size-8 shrink-0 place-items-center rounded-full border border-line text-brand transition-transform duration-300 group-open:rotate-45">
                <Plus className="size-4" aria-hidden="true" />
              </span>
            </summary>
            <p className="max-w-3xl pb-6 pe-12 text-pretty leading-relaxed text-ink-2">{f.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
