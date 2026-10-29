"use client";

import { ChevronDown, Clock, PhoneMissed, TrendingUp } from "lucide-react";
import { useDeferredValue, useEffect, useId, useMemo, useState } from "react";
import { brand, pricing } from "@/config/site";
import { HUMAN_TALK_MINUTES_PER_MONTH, computeRoi } from "@/lib/roi";
import { formatIls, formatIlsText, formatNumber } from "@/lib/format";
import { Eyebrow } from "@/components/ui/Section";

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  display,
  hint,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  display: (v: number) => string;
  hint?: string;
}) {
  const id = useId();
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-[0.95rem] font-medium text-on-forest-2">
          {label}
        </label>
        {/* The slider announces its own value (aria-valuetext); this is the visual readout. */}
        <output htmlFor={id} aria-hidden="true" className="ltr tabular text-lg font-bold text-on-forest">
          {display(value)}
        </output>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-valuetext={display(value)}
        className="roi-range mt-3 w-full"
        style={{ "--pct": `${pct}%` } as React.CSSProperties}
      />
      {hint ? <p className="mt-1.5 text-xs text-on-forest-2/80">{hint}</p> : null}
    </div>
  );
}

export function RoiCalculator() {
  const [calls, setCalls] = useState(300);
  const [employeeCost, setEmployeeCost] = useState(12500);
  const [missedPct, setMissedPct] = useState(20);
  const [avgMinutes, setAvgMinutes] = useState(3);
  const [customerValue, setCustomerValue] = useState(800);
  const [conversionPct, setConversionPct] = useState(25);

  const r = useMemo(
    () =>
      computeRoi({
        callsPerMonth: calls,
        avgCallMinutes: avgMinutes,
        employeeMonthlyCost: employeeCost,
        missedRate: missedPct / 100,
        avgCustomerValue: customerValue,
        missedConversionRate: conversionPct / 100,
      }),
    [calls, avgMinutes, employeeCost, missedPct, customerValue, conversionPct],
  );

  const maxCost = Math.max(r.humanCost, r.agentCost, 1);
  const saves = r.monthlySavings > 0;

  // One polite, debounced summary for screen readers instead of announcing every slider step.
  const summary = `${saves ? "חיסכון חודשי" : "הפרש חודשי"} ${formatIls(Math.abs(r.monthlySavings))}, ${formatNumber(r.missedCalls)} שיחות שלא נענות בחודש.`;
  const deferredSummary = useDeferredValue(summary);
  const [announced, setAnnounced] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setAnnounced(deferredSummary), 700);
    return () => clearTimeout(id);
  }, [deferredSummary]);

  return (
    <section id="roi" aria-labelledby="roi-title" className="scroll-mt-24 px-2 py-10 sm:px-3">
      <div className="forest-panel on-forest rounded-[2rem] py-16 sm:rounded-[2.5rem] sm:py-24">
        <div className="container-page">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.15fr_1fr] lg:items-end lg:gap-16" data-reveal>
            <div>
              <Eyebrow className="text-accent">מחשבון חיסכון</Eyebrow>
              <h2 id="roi-title" className="mt-3 text-balance text-3xl font-extrabold tracking-tight sm:text-4xl lg:text-5xl">
                כמה עולה לכם המענה הטלפוני היום?
              </h2>
            </div>
            <p className="text-pretty text-lg leading-relaxed text-on-forest-2">
              הזיזו את המחוונים לפי העסק שלכם, ותראו את ההפרש בעלות, בשעות ובשיחות שהולכות לאיבוד.
            </p>
          </div>

          <div className="mt-12 grid grid-cols-1 gap-4 lg:grid-cols-[1fr_1.1fr]" data-reveal>
            <div className="rounded-[1.75rem] border border-white/10 bg-white/[0.04] p-5 sm:p-7">
              <div className="space-y-7">
                <Slider label="כמה שיחות יש לכם בחודש?" value={calls} min={20} max={3000} step={10} onChange={setCalls} display={(v) => formatNumber(v)} />
                <Slider
                  label="כמה עולה עובד/ת מענה טלפוני? (עלות מעסיק)"
                  value={employeeCost}
                  min={5000}
                  max={30000}
                  step={500}
                  onChange={setEmployeeCost}
                  display={(v) => `${formatIls(v)}`}
                />
                <Slider label="כמה שיחות לא נענות היום?" value={missedPct} min={0} max={60} step={1} onChange={setMissedPct} display={(v) => `${v}%`} />
              </div>

              <details className="group mt-7 border-t border-white/10 pt-5">
                <summary className="flex cursor-pointer list-none items-center gap-1.5 text-sm font-semibold text-accent">
                  חישוב מתקדם
                  <ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden="true" />
                </summary>
                <div className="mt-6 space-y-7">
                  <Slider
                    label="אורך שיחה ממוצע"
                    value={avgMinutes}
                    min={1}
                    max={10}
                    step={0.5}
                    onChange={setAvgMinutes}
                    display={(v) => `${formatNumber(v)} דק׳`}
                  />
                  <Slider
                    label="שווי לקוח חדש בממוצע"
                    value={customerValue}
                    min={0}
                    max={20000}
                    step={100}
                    onChange={setCustomerValue}
                    display={(v) => formatIls(v)}
                  />
                  <Slider
                    label="כמה מהשיחות שלא נענו היו הופכות ללקוחות?"
                    value={conversionPct}
                    min={0}
                    max={100}
                    step={5}
                    onChange={setConversionPct}
                    display={(v) => `${v}%`}
                  />
                </div>
              </details>
            </div>

            <div className="rounded-[1.75rem] bg-surface p-5 text-ink shadow-float sm:p-7">
              <p className="sr-only" aria-live="polite">
                {announced}
              </p>
              <div className="space-y-4">
                <div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-ink-2">
                      היום{r.employeesNeeded > 1 ? ` (${r.employeesNeeded} עובדים)` : ""}
                    </span>
                    <span className="ltr tabular font-bold">{formatIls(r.humanCost)}</span>
                  </div>
                  <div className="mt-2 h-3.5 overflow-hidden rounded-full bg-surface-2">
                    <div className="h-full rounded-full bg-[#7c6cf0] transition-[width] duration-500" style={{ width: `${(r.humanCost / maxCost) * 100}%` }} />
                  </div>
                </div>
                <div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-ink-2">
                      עם <span dir="ltr">{brand.name}</span> ({r.quote.plan.name}
                      {r.quote.extraMinutes > 0 ? ` + ${formatNumber(r.quote.extraMinutes)} דק׳` : ""})
                    </span>
                    <span className="ltr tabular font-bold">{formatIls(r.agentCost)}</span>
                  </div>
                  <div className="mt-2 h-3.5 overflow-hidden rounded-full bg-surface-2">
                    <div className="h-full rounded-full bg-brand transition-[width] duration-500" style={{ width: `${Math.max(2, (r.agentCost / maxCost) * 100)}%` }} />
                  </div>
                </div>
              </div>

              <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="rounded-2xl bg-tint p-4 sm:col-span-2">
                  <p className="text-sm font-semibold text-brand">{saves ? "חוסכים בחודש" : "ההפרש בחודש"}</p>
                  <p className="ltr tabular mt-1 text-start text-4xl font-extrabold tracking-tight sm:text-5xl">{formatIls(Math.abs(r.monthlySavings))}</p>
                  <p className="mt-1 text-sm text-ink-2">
                    {saves ? (
                      <>
                        <span className="ltr tabular font-semibold">{formatIls(r.yearlySavings)}</span> בשנה, עם מענה 24/7 במקום שעות משרד.
                      </>
                    ) : (
                      "בעלות דומה, מקבלים מענה 24/7, אפס שיחות שלא נענות ותיעוד מלא לכל שיחה."
                    )}
                  </p>
                </div>
                <div className="rounded-2xl border border-line p-4">
                  <PhoneMissed className="size-5 text-brand" aria-hidden="true" />
                  <p className="ltr tabular mt-2 text-start text-2xl font-extrabold">{formatNumber(r.missedCalls)}</p>
                  <p className="text-sm text-ink-2">שיחות בחודש שהולכות היום לאיבוד</p>
                </div>
                <div className="rounded-2xl border border-line p-4">
                  <TrendingUp className="size-5 text-brand" aria-hidden="true" />
                  <p className="ltr tabular mt-2 text-start text-2xl font-extrabold">{formatIls(r.recoveredRevenue)}</p>
                  <p className="text-sm text-ink-2">הכנסה חודשית שאפשר להציל מהן</p>
                </div>
                <div className="flex items-center gap-3 rounded-2xl border border-line p-4 sm:col-span-2">
                  <Clock className="size-5 shrink-0 text-brand" aria-hidden="true" />
                  <p className="text-sm text-ink-2">
                    <span className="ltr tabular font-bold text-ink">{formatNumber(r.talkHours)}</span> שעות שיחה בחודש עוברות לנציגה, והצוות מתפנה לעבודה עצמה.
                  </p>
                </div>
              </div>

              <p className="mt-5 text-xs leading-relaxed text-ink-3">
                הנחות החישוב: {formatNumber(calls)} שיחות × {formatNumber(avgMinutes)} דקות = {formatNumber(r.totalMinutes)} דקות בחודש. עובד/ת
                מדבר/ת בפועל כ-{formatNumber(HUMAN_TALK_MINUTES_PER_MONTH)} דקות בחודש (שאר המשמרת הולך על חיוג, המתנה ותיעוד), ולכן{" "}
                {r.employeesNeeded === 1 ? "מספיק עובד/ת אחד/ת" : `נדרשים ${r.employeesNeeded} עובדים`} לכמות הזאת. החבילה המשתלמת נבחרת
                אוטומטית, דקה נוספת ב-{formatIlsText(pricing.extraMinutePrice)}, לפני מע״מ. ההערכה להמחשה בלבד.{" "}
                <a href="#pricing" className="font-semibold text-brand underline underline-offset-2">
                  למחירון המלא
                </a>
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
