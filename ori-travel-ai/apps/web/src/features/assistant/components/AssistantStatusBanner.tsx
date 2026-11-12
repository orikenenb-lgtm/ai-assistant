import { Link } from 'react-router';
import { Bot, Coins } from 'lucide-react';
import { Callout, Skeleton } from '@/components/ui';
import { useAiStatus } from '../hooks';

/** Honest availability banner: model vs. basic (rule-based) mode, from GET /api/ai/status. */
export function AssistantStatusBanner() {
  const status = useAiStatus();

  if (status.isPending) return <Skeleton className="h-16 w-full" />;
  if (status.isError) {
    return (
      <Callout tone="neutral" title="לא ניתן לבדוק את מצב העוזר" role="status">
        העוזר יפעל במצב בסיסי אם אין מודל זמין. בדקו שוב בעוד רגע.
      </Callout>
    );
  }
  const s = status.data;
  if (s.available) {
    return (
      <Callout tone="success" icon={<Bot />} title={`מודל AI פעיל — ${s.label}`} data-testid="ai-status-model">
        <p>{s.message}</p>
        {s.paid && (
          <p className="mt-2 flex items-start gap-1.5">
            <Coins className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>זהו ספק בתשלום: כל הודעה עשויה לצרוך מכסה או לגרור עלות בחשבון הספק.</span>
          </p>
        )}
      </Callout>
    );
  }
  return (
    <Callout
      tone="warn"
      icon={<Bot />}
      title="מצב בסיסי ללא מודל AI"
      data-testid="ai-status-fallback"
      action={
        <span className="flex flex-wrap gap-x-4 gap-y-1 text-sm font-medium">
          <Link to="/settings" className="text-accent underline-offset-4 hover:underline">
            הגדרות
          </Link>
          <Link to="/help" className="text-accent underline-offset-4 hover:underline">
            עזרה
          </Link>
        </span>
      }
    >
      <p>
        {s.message} במצב הזה העוזר מבין בקשות פשוטות בעברית (יעד, תאריכים, מספר נוסעים) ומפעיל חיפוש רגיל במערכת, אך אינו מנהל שיחה
        חופשית. חיבור מודל אפשרי בהגדרות השרת.
      </p>
    </Callout>
  );
}
