import { ClipboardCheck, Plus } from 'lucide-react';
import { useContext, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Button, Callout, Field, NativeSelect, PageHeader } from '@/components/ui';
import { QueryState } from '@/components/QueryState';
import { canBook } from '@/features/auth';
import { AuthContext } from '@/features/auth/context';
import { BookingsList, FILTER_STATES, STATE_LABELS, StartBookingDialog, useBookings } from '@/features/bookings';

export default function BookingsPage() {
  const user = useContext(AuthContext)?.user ?? null;
  const [params, setParams] = useSearchParams();
  const state = params.get('state');
  const page = Math.max(1, Number(params.get('page')) || 1);
  const offerId = params.get('offer_id');
  const [manualOpen, setManualOpen] = useState(false);
  const mayBook = canBook(user);
  const dialogOpen = mayBook && (!!offerId || manualOpen);
  const query = useBookings(state, page);

  function update(next: Record<string, string | null>) {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    setParams(p, { replace: true });
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
      <PageHeader
        title="סקירת הזמנות"
        icon={<ClipboardCheck />}
        description="הכנת הזמנות בצורה בטוחה: בדיקת מחיר מול הספק, אישור מפורש של התנאים עם סיסמה, ושליחה בסימולציה בלבד או מעבר לאתר הספק. לא מתבצעת רכישה אמיתית מתוך המערכת."
        actions={
          mayBook ? (
            <Button leadingIcon={<Plus aria-hidden="true" />} onClick={() => setManualOpen(true)}>
              הכנת הזמנה חדשה
            </Button>
          ) : undefined
        }
      />
      {!mayBook && (
        <Callout tone="info" title="צפייה בלבד" data-testid="read-only-note">
          אפשר לצפות בהזמנות, אך הכנה ואישור של הזמנות שמורים לבעלים או למבוגר/ת שהוצהר/ה כבגיר/ה.
        </Callout>
      )}
      <div className="max-w-xs">
        <Field label="סינון לפי מצב">
          <NativeSelect
            value={state ?? ''}
            onChange={(e) => update({ state: e.target.value || null, page: null })}
            placeholder="כל המצבים"
            options={FILTER_STATES.map((s) => ({ value: s, label: STATE_LABELS[s] }))}
          />
        </Field>
      </div>
      <QueryState query={query} errorTitle="לא ניתן לטעון את ההזמנות" compact={false} loading={<BookingsList items={[]} total={0} page={1} loading onPageChange={() => {}} filtered={false} />}>
        {(data) => (
          <BookingsList
            items={data.items}
            total={data.total}
            page={data.page}
            filtered={!!state}
            onPageChange={(p) => update({ page: p > 1 ? String(p) : null })}
          />
        )}
      </QueryState>
      {dialogOpen && (
        <StartBookingDialog
          initialOfferId={offerId}
          onClose={() => {
            setManualOpen(false);
            if (offerId) update({ offer_id: null });
          }}
        />
      )}
    </div>
  );
}
