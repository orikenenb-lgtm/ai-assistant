import { Checkbox, Field, Input, NativeSelect } from '@/components/ui';
import { cabinLabel } from '@/features/offers/labels';
import type { Category } from '@/lib/schemas/common';
import type { DepartWindow, OfferFilters } from '../filters';

const WINDOW_FILTER_LABELS: Record<DepartWindow, string> = {
  morning: 'בוקר (05:00–12:00)',
  afternoon: 'צהריים (12:00–17:00)',
  evening: 'ערב (17:00–21:00)',
  night: 'לילה (21:00–05:00)',
};

export interface FilterPanelProps {
  category: Category;
  filters: OfferFilters;
  onChange: (patch: Partial<OfferFilters>) => void;
  providers: Array<{ id: string; name: string }>;
  carriers: string[];
  currency: string;
  /** Cabins present in the results (flights) — the cabin filter only shows when there are two or more. */
  cabins?: Array<{ value: string; count: number }>;
  /** Outbound departure windows present in the results, with counts (flights). */
  windows?: ReadonlyMap<DepartWindow, number>;
}

function toggle(list: string[], v: string): string[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

function CheckList({ legend, items, value, onChange }: { legend: string; items: Array<{ id: string; name: string }>; value: string[]; onChange: (v: string[]) => void }) {
  if (items.length < 2) return null;
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium text-fg">{legend}</legend>
      {items.map((it) => (
        <Checkbox key={it.id} label={it.name} checked={value.includes(it.id)} onChange={() => onChange(toggle(value, it.id))} />
      ))}
    </fieldset>
  );
}

/** Quick client-side filters (no network). What's offered depends on the category. */
export function FilterPanel({ category, filters: f, onChange, providers, carriers, currency, cabins = [], windows }: FilterPanelProps) {
  return (
    <section aria-labelledby="filters-title" className="flex flex-col gap-4">
      <h3 id="filters-title" className="text-sm font-bold text-fg">
        סינון מהיר
      </h3>
      <Field label={`מחיר מקסימלי (${currency})`} optional>
        <Input
          inputMode="decimal"
          dir="ltr"
          className="text-start"
          placeholder="ללא הגבלה"
          value={f.maxPrice}
          onChange={(e) => onChange({ maxPrice: e.target.value.replace(/[^\d.]/g, '') })}
        />
      </Field>
      <Checkbox label="ביטול חינם / החזר בלבד" checked={f.freeCancellation} onChange={(e) => onChange({ freeCancellation: e.target.checked })} />

      {category === 'flight' && (
        <>
          <Field label="עצירות">
            <NativeSelect
              value={f.maxStops}
              onChange={(e) => onChange({ maxStops: e.target.value as OfferFilters['maxStops'] })}
              options={[
                { value: '', label: 'לא משנה' },
                { value: '0', label: 'ישירות בלבד' },
                { value: '1', label: 'עד עצירה אחת' },
              ]}
            />
          </Field>
          <Checkbox
            label="כולל מזוודה לבטן"
            description="רק הצעות שבהן הספק מציין מזוודה לבטן כלולה במחיר"
            checked={f.checkedBag}
            onChange={(e) => onChange({ checkedBag: e.target.checked })}
          />
          <Field label="שעת המראה (הלוך)">
            <NativeSelect
              value={f.departWindow}
              onChange={(e) => onChange({ departWindow: e.target.value as OfferFilters['departWindow'] })}
              options={[
                { value: '', label: 'כל שעה' },
                ...(Object.keys(WINDOW_FILTER_LABELS) as DepartWindow[]).map((w) => ({
                  value: w,
                  label: `${WINDOW_FILTER_LABELS[w]} · ${windows?.get(w) ?? 0}`,
                })),
              ]}
            />
          </Field>
          {(cabins.length > 1 || f.cabin !== '') && (
            <Field label="מחלקה">
              <NativeSelect
                value={f.cabin}
                onChange={(e) => onChange({ cabin: e.target.value })}
                options={[{ value: '', label: 'כל המחלקות' }, ...cabins.map((c) => ({ value: c.value, label: `${cabinLabel(c.value)} · ${c.count}` }))]}
              />
            </Field>
          )}
          {carriers.length > 1 && (
            <CheckList
              legend="חברת תעופה"
              items={carriers.map((c) => ({ id: c, name: c }))}
              value={f.carriers}
              onChange={(carriersSel) => onChange({ carriers: carriersSel })}
            />
          )}
        </>
      )}

      {category === 'hotel' && (
        <>
          <Field label="כוכבים">
            <NativeSelect
              value={String(f.minStars)}
              onChange={(e) => onChange({ minStars: Number(e.target.value) })}
              options={[
                { value: '0', label: 'לא משנה' },
                { value: '3', label: '3+ כוכבים' },
                { value: '4', label: '4+ כוכבים' },
                { value: '5', label: '5 כוכבים' },
              ]}
            />
          </Field>
          <Field label="דירוג אורחים">
            <NativeSelect
              value={String(f.minGuestRating)}
              onChange={(e) => onChange({ minGuestRating: Number(e.target.value) })}
              options={[
                { value: '0', label: 'לא משנה' },
                { value: '7', label: '7+ מתוך 10' },
                { value: '8', label: '8+ מתוך 10' },
                { value: '9', label: '9+ מתוך 10' },
              ]}
            />
          </Field>
          <Field label="ארוחות">
            <NativeSelect
              value={f.minBoard}
              onChange={(e) => onChange({ minBoard: e.target.value as OfferFilters['minBoard'] })}
              options={[
                { value: '', label: 'לא משנה' },
                { value: 'breakfast', label: 'ארוחת בוקר ומעלה' },
                { value: 'half_board', label: 'חצי פנסיון ומעלה' },
                { value: 'all_inclusive', label: 'הכול כלול' },
              ]}
            />
          </Field>
          <Checkbox label="עם מידע על כשרות מהספק" checked={f.kosherInfo} onChange={(e) => onChange({ kosherInfo: e.target.checked })} />
          <Checkbox label="עם מאפייני נגישות" checked={f.accessible} onChange={(e) => onChange({ accessible: e.target.checked })} />
        </>
      )}

      {category === 'car' && (
        <>
          <Field label="תיבת הילוכים">
            <NativeSelect
              value={f.transmission}
              onChange={(e) => onChange({ transmission: e.target.value as OfferFilters['transmission'] })}
              options={[
                { value: '', label: 'לא משנה' },
                { value: 'automatic', label: 'אוטומטי' },
                { value: 'manual', label: 'ידני' },
              ]}
            />
          </Field>
          <Field label="מקומות מינימום">
            <NativeSelect
              value={String(f.minSeats)}
              onChange={(e) => onChange({ minSeats: Number(e.target.value) })}
              options={[0, 4, 5, 7].map((n) => ({ value: String(n), label: n ? `${n}+` : 'לא משנה' }))}
            />
          </Field>
        </>
      )}

      {category === 'activity' && (
        <>
          <Checkbox label="מתאים למשפחות" checked={f.familyFriendly} onChange={(e) => onChange({ familyFriendly: e.target.checked })} />
          <Checkbox label="עם מאפייני נגישות" checked={f.accessible} onChange={(e) => onChange({ accessible: e.target.checked })} />
          <Field label="דירוג מינימלי">
            <NativeSelect
              value={String(f.minRating)}
              onChange={(e) => onChange({ minRating: Number(e.target.value) })}
              options={[
                { value: '0', label: 'לא משנה' },
                { value: '4', label: '4+ מתוך 5' },
                { value: '4.5', label: '4.5+ מתוך 5' },
              ]}
            />
          </Field>
        </>
      )}

      <CheckList legend="ספק" items={providers} value={f.providers} onChange={(providersSel) => onChange({ providers: providersSel })} />
    </section>
  );
}
