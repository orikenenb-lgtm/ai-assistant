import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Button, Callout, Checkbox, Dialog, Field, MoneyText, NativeSelect, Skeleton } from '@/components/ui';
import { familyKeys, fetchMembers } from '@/features/family/api';
import { SourceLine, useOffer } from '@/features/offers';
import { fetchSaved, savedKeys } from '@/features/saved/api';
import { fetchTrips, tripKeys } from '@/features/trips/api';
import { isApiError } from '@/lib/api';
import { CATEGORY_SINGULAR } from '@/lib/labels';
import { SIMULATION_SCENARIOS, type SimulationScenario } from '@/lib/schemas/bookings';
import type { CanonicalOffer } from '@/lib/schemas/offers';
import { describeBookingError } from '../errors';
import { useCreateBooking } from '../hooks';
import { SCENARIO_LABELS } from '../labels';

const MAX_TRAVELERS = 9;
const AGE_LABELS: Record<string, string> = { adult: 'מבוגר/ת', child: 'ילד/ה', infant: 'תינוק/ת' };

export interface StartBookingDialogProps {
  /** Pre-selected offer (from `?offer_id=`). */
  initialOfferId?: string | null;
  onClose: () => void;
}

export function StartBookingDialog({ initialOfferId, onClose }: StartBookingDialogProps) {
  const navigate = useNavigate();
  const create = useCreateBooking();
  const saved = useQuery({ queryKey: savedKeys.all, queryFn: fetchSaved });
  const members = useQuery({ queryKey: familyKeys.members, queryFn: fetchMembers });
  const trips = useQuery({ queryKey: tripKeys.list, queryFn: fetchTrips });

  const [offerId, setOfferId] = useState<string>(initialOfferId ?? '');
  const [selected, setSelected] = useState<string[]>([]);
  const [tripId, setTripId] = useState('');
  const [scenario, setScenario] = useState<SimulationScenario>('success');
  const [problem, setProblem] = useState<ReturnType<typeof describeBookingError> | null>(null);

  // The offer to show: prefer the saved copy, otherwise ask the server.
  const savedMatch = saved.data?.find((s) => s.offer_id === offerId);
  const savedSettled = saved.isSuccess || saved.isError;
  const offerQuery = useOffer(offerId || null, !!offerId && savedSettled && !savedMatch);
  const offer: CanonicalOffer | null = savedMatch?.offer ?? offerQuery.data ?? null;

  const offerOptions = useMemo(() => {
    const items = (saved.data ?? []).map((s) => ({
      value: s.offer_id,
      label: `${CATEGORY_SINGULAR[s.category]}: ${s.offer.title}${s.is_expired ? ' (פג תוקף)' : ''}`,
      disabled: s.is_expired,
    }));
    if (initialOfferId && !items.some((i) => i.value === initialOfferId)) {
      items.unshift({ value: initialOfferId, label: offer ? `${CATEGORY_SINGULAR[offer.category]}: ${offer.title}` : 'ההצעה שנבחרה', disabled: false });
    }
    return items;
  }, [saved.data, initialOfferId, offer]);

  const isDemo = offer?.source.mode === 'DEMO';
  const offerMissing = !savedMatch && offerQuery.isError && isApiError(offerQuery.error) && offerQuery.error.status === 404;
  const canSubmit = !!offerId && selected.length >= 1 && selected.length <= MAX_TRAVELERS && !create.isPending && !offerMissing;

  async function submit() {
    setProblem(null);
    try {
      const booking = await create.mutateAsync({
        offer_id: offerId,
        traveler_member_ids: selected,
        ...(tripId ? { trip_id: tripId } : {}),
        ...(isDemo ? { simulation_scenario: scenario } : {}),
      });
      onClose();
      void navigate(`/bookings/${encodeURIComponent(booking.id)}`);
    } catch (e) {
      setProblem(describeBookingError(e));
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !create.isPending && onClose()}
      size="lg"
      title="הכנת הזמנה"
      description="בוחרים הצעה ונוסעים. נוצרת טיוטה בלבד — שום דבר לא נשלח לספק ולא מתבצע חיוב. בהמשך תבדקו מחיר ותאשרו תנאים."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={create.isPending}>
            ביטול
          </Button>
          <Button onClick={() => void submit()} loading={create.isPending} disabled={!canSubmit}>
            יצירת הזמנה להכנה
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        {problem && (
          <Callout tone={problem.tone} title={problem.title} role="alert">
            {problem.message}
          </Callout>
        )}

        <Field label="הצעה" hint="ההצעות מרשימת ההצעות השמורות שלכם. אפשר לשמור הצעה מתוצאות החיפוש.">
          {saved.isPending && !initialOfferId ? (
            <Skeleton className="h-10 w-full" />
          ) : (
            <NativeSelect
              value={offerId}
              onChange={(e) => setOfferId(e.target.value)}
              placeholder="בחרו הצעה שמורה"
              options={offerOptions}
            />
          )}
        </Field>
        {saved.isError && !initialOfferId && (
          <Callout tone="neutral">לא ניתן לטעון את ההצעות השמורות כרגע.</Callout>
        )}
        {offerMissing && (
          <Callout tone="danger" role="alert">
            ההצעה לא נמצאה או שתוקפה פג. חפשו מחדש ושמרו את ההצעה.
          </Callout>
        )}
        {offer && (
          <div className="rounded-lg border border-line bg-surface-sunken p-3 text-sm" data-testid="selected-offer">
            <p className="font-semibold text-fg">{offer.title}</p>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
              <MoneyText value={offer.price.total} className="font-bold" estimated={offer.price.total_status === 'estimated'} />
              <SourceLine source={offer.source} />
            </div>
          </div>
        )}

        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium text-fg">נוסעים</legend>
          {members.isPending ? (
            <Skeleton className="h-20 w-full" />
          ) : members.isError ? (
            <Callout tone="danger" role="alert">
              לא ניתן לטעון את בני המשפחה.
            </Callout>
          ) : members.data.length === 0 ? (
            <Callout tone="warn">אין עדיין בני משפחה. הוסיפו בני משפחה בעמוד המשפחה כדי להכין הזמנה.</Callout>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {members.data.map((m) => (
                <Checkbox
                  key={m.id}
                  label={m.display_name}
                  description={AGE_LABELS[m.age_group] ?? m.age_group}
                  checked={selected.includes(m.id)}
                  onChange={(e) => setSelected((cur) => (e.target.checked ? [...cur, m.id] : cur.filter((x) => x !== m.id)))}
                />
              ))}
            </div>
          )}
          <p className="text-xs text-fg-subtle">בחרו בין נוסע אחד ל-{MAX_TRAVELERS}. מספר הנוסעים צריך להתאים למה שחיפשתם — אחרת תוצג אזהרה.</p>
        </fieldset>

        {trips.data && trips.data.length > 0 && (
          <Field label="טיול" optional hint="קישור ההזמנה לטיול קיים">
            <NativeSelect
              value={tripId}
              onChange={(e) => setTripId(e.target.value)}
              placeholder="ללא טיול"
              options={trips.data.map((t) => ({ value: t.id, label: t.title }))}
            />
          </Field>
        )}

        {isDemo && (
          <Field label="תרחיש סימולציה" hint={SCENARIO_LABELS[scenario].description}>
            <NativeSelect
              value={scenario}
              onChange={(e) => setScenario(e.target.value as SimulationScenario)}
              options={SIMULATION_SCENARIOS.map((s) => ({ value: s, label: `${SCENARIO_LABELS[s].label} — ${SCENARIO_LABELS[s].description}` }))}
            />
          </Field>
        )}
      </div>
    </Dialog>
  );
}
