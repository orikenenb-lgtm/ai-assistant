import { FlaskConical, ShieldAlert, Store } from 'lucide-react';
import { Callout } from '@/components/ui';
import type { ExecutionMode } from '@/lib/schemas/bookings';

/** The most prominent element of the review screen: what will (not) happen. */
export function ExecutionBanner({ mode }: { mode: ExecutionMode }) {
  if (mode === 'SIMULATION') {
    return (
      <div
        data-testid="execution-banner"
        data-mode="SIMULATION"
        role="note"
        className="flex items-start gap-3 rounded-xl border-2 border-dashed border-sand-500 bg-sand-100 p-4 text-sand-900"
      >
        <FlaskConical className="mt-0.5 size-6 shrink-0" aria-hidden="true" />
        <div>
          <p className="text-lg font-bold">סימולציה — לא תתבצע רכישה אמיתית</p>
          <p className="mt-0.5 text-sm">הספק מדומה, הנתונים הם נתוני הדגמה, ולא יבוצע חיוב בשום כרטיס.</p>
        </div>
      </div>
    );
  }
  if (mode === 'HOSTED_CHECKOUT') {
    return (
      <div
        data-testid="execution-banner"
        data-mode="HOSTED_CHECKOUT"
        role="note"
        className="flex items-start gap-3 rounded-xl border-2 border-harbor-200 bg-harbor-50 p-4 text-harbor-700"
      >
        <Store className="mt-0.5 size-6 shrink-0" aria-hidden="true" />
        <div>
          <p className="text-lg font-bold">ההזמנה תושלם באתר הספק; אנחנו לא מחייבים כרטיס</p>
          <p className="mt-0.5 text-sm">אחרי אישור התנאים תועברו לאתר הספק, ושם תשלמו. בסיום תרשמו כאן את מספר האישור.</p>
        </div>
      </div>
    );
  }
  return (
    <Callout tone="danger" icon={<ShieldAlert />} title="ביצוע הזמנה אמיתית דרך המערכת כבוי" data-testid="execution-banner">
      לא ניתן לשלוח הזמנה זו. אפשר להכין ולאשר תנאים בלבד.
    </Callout>
  );
}
