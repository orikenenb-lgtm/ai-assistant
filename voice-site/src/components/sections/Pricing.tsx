import { Building, Check, Sparkles } from "lucide-react";
import { clsx } from "clsx";
import { plans, pricing } from "@/config/site";
import { formatIls, formatIlsPrecise } from "@/lib/format";
import { SectionHeading } from "@/components/ui/Section";
import { buttonClass } from "@/components/ui/Button";

export function Pricing() {
  return (
    <section id="pricing" aria-labelledby="pricing-title" className="container-page scroll-mt-24 py-20 sm:py-28">
      <SectionHeading
        align="center"
        id="pricing-title"
        eyebrow="מחירון"
        title="מחיר חודשי אחד. בלי הפתעות."
        lead={`הנציגה, דקות השיחה, מספר ישראלי והמערכת. בלי דמי הקמה, בלי התחייבות, ו-${pricing.trialMinutes} דקות לבנות ולנסות בחינם.`}
      />

      <ul className="mx-auto mt-12 grid grid-cols-1 max-w-6xl gap-4 lg:grid-cols-3">
        {plans.map((plan, i) => (
          <li
            key={plan.id}
            data-reveal
            style={{ "--reveal-delay": `${i * 90}ms` } as React.CSSProperties}
            className={clsx(
              "relative flex flex-col rounded-[2rem] p-6 sm:p-8",
              plan.highlight ? "forest-panel on-forest shadow-float lg:-my-3 lg:py-11" : "border border-line bg-surface shadow-soft",
            )}
          >
            {plan.highlight ? (
              <span className="absolute -top-3.5 start-6 inline-flex items-center gap-1 rounded-full bg-accent px-3 py-1 text-xs font-bold text-accent-ink">
                <Sparkles className="size-3.5" aria-hidden="true" /> הכי פופולרי
              </span>
            ) : null}
            <h3 className="text-xl font-extrabold">
              <span dir="ltr">{plan.name}</span>
            </h3>
            <p className={clsx("mt-1 text-sm", plan.highlight ? "text-on-forest-2" : "text-ink-3")}>{plan.blurb}</p>
            <p className="mt-6 flex items-baseline gap-2">
              <span className="ltr tabular text-5xl font-extrabold tracking-tight">{formatIls(plan.price)}</span>
              <span className={clsx("text-sm", plan.highlight ? "text-on-forest-2" : "text-ink-3")}>לחודש + מע״מ</span>
            </p>
            <a
              href={`#contact`}
              data-plan={plan.id}
              className={buttonClass(plan.highlight ? "accent" : "primary", "lg", "mt-6 w-full")}
            >
              מתחילים עם {plan.name}
            </a>
            <ul className="mt-7 space-y-3 text-[0.95rem]">
              {plan.features.map((f) => {
                const heading = f.endsWith(":");
                return (
                  <li key={f} className={clsx("flex items-start gap-2.5", heading && "font-semibold")}>
                    {heading ? null : (
                      <Check className={clsx("mt-1 size-4 shrink-0", plan.highlight ? "text-accent" : "text-brand")} aria-hidden="true" />
                    )}
                    <span>{f}</span>
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ul>

      <div className="mx-auto mt-6 grid grid-cols-1 max-w-6xl gap-4 md:grid-cols-[1fr_auto] md:items-center" data-reveal>
        <div className="flex flex-col gap-4 rounded-[1.75rem] border border-line bg-surface-2/60 p-5 sm:flex-row sm:items-center sm:p-6">
          <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-surface text-brand">
            <Building className="size-5" aria-hidden="true" />
          </span>
          <div className="flex-1">
            <p className="font-bold">נפח גדול, כמה סניפים או מוקד?</p>
            <p className="mt-1 text-sm leading-relaxed text-ink-2">
              הצעת מחיר מותאמת עם דקות בכמויות, סוכנים נוספים, SLA וחיבורים מיוחדים. דקה נוספת בכל החבילות:{" "}
              <span className="ltr font-semibold">{formatIlsPrecise(pricing.extraMinutePrice)}</span>.
            </p>
          </div>
          <a href="#contact" className={buttonClass("outline", "md", "shrink-0")}>
            לקבלת הצעה
          </a>
        </div>
      </div>
      <p className="mt-4 text-center text-sm text-ink-3">{pricing.vatNote}</p>
    </section>
  );
}
