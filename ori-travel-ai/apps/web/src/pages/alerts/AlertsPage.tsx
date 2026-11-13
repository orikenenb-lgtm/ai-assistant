import { Bell, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { QueryState } from '@/components/QueryState';
import { Button, Callout, EmptyState, PageHeader, Skeleton } from '@/components/ui';
import { AlertCard } from '@/features/alerts/components/AlertCard';
import { AlertFormDialog, type AlertSeed } from '@/features/alerts/components/AlertFormDialog';
import { NotificationsList } from '@/features/alerts/components/NotificationsList';
import { useAlerts } from '@/features/alerts/hooks';
import { canEdit, isOwner, useAuth } from '@/features/auth';
import { fetchSearchResult } from '@/features/search/api';
import { useSettings } from '@/features/settings/hooks';
import { isApiError } from '@/lib/api';
import type { Alert } from '@/lib/schemas/alerts';

function SchedulerNote() {
  const settings = useSettings();
  if (!settings.data) return null;
  const { enabled, allowed_by_server } = settings.data.scheduler;
  if (enabled && allowed_by_server) {
    return (
      <Callout tone="success" title="בדיקות אוטומטיות פעילות">
        כל התראה פעילה נבדקת ברקע לפי התדירות שהוגדרה לה. אפשר גם לבדוק ידנית בכל רגע (פעם ב-5 דקות לכל התראה).
      </Callout>
    );
  }
  return (
    <Callout tone="info" title="בדיקות אוטומטיות כבויות — אפשר לבדוק ידנית">
      {!allowed_by_server
        ? 'השרת אינו מאפשר בדיקות ברקע (מוגדר בשרת), ולכן התראות נבדקות רק כשלוחצים "בדוק עכשיו".'
        : 'בעל החשבון לא הפעיל בדיקות ברקע בהגדרות, ולכן התראות נבדקות רק כשלוחצים "בדוק עכשיו".'}
    </Callout>
  );
}

export default function AlertsPage() {
  const { user } = useAuth();
  const editable = canEdit(user);
  const query = useAlerts();
  const [params, setParams] = useSearchParams();
  const fromSearch = params.get('from_search');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Alert | null>(null);
  const [seed, setSeed] = useState<AlertSeed | undefined>(undefined);
  const [seedError, setSeedError] = useState<string | null>(null);

  // "Create from current search": load the stored search once and open the form pre-filled.
  useEffect(() => {
    if (!fromSearch || !editable) return;
    let cancelled = false;
    fetchSearchResult(fromSearch)
      .then((r) => {
        if (cancelled) return;
        setSeed({ category: r.category, params: r.params });
        setCreating(true);
      })
      .catch((e) => {
        if (!cancelled) setSeedError(isApiError(e) ? e.message : 'לא ניתן לטעון את החיפוש');
      });
    return () => {
      cancelled = true;
    };
  }, [fromSearch, editable]);

  function closeCreate(open: boolean) {
    setCreating(open);
    if (!open) {
      setSeed(undefined);
      if (params.has('from_search')) {
        const next = new URLSearchParams(params);
        next.delete('from_search');
        setParams(next, { replace: true });
      }
    }
  }

  const newButton = editable ? (
    <Button leadingIcon={<Plus aria-hidden="true" />} onClick={() => { setSeed(undefined); setCreating(true); }}>
      התראה חדשה
    </Button>
  ) : null;

  return (
    <>
      <PageHeader
        title="התראות מחיר"
        description="נבדוק חיפוש שמור מדי פעם ונודיע כשהמחיר הטוב ביותר מגיע ליעד שלכם. המחירים נבדקים מול הספקים הפעילים בלבד."
        icon={<Bell />}
        actions={newButton}
      />
      <div className="flex flex-col gap-6">
        <SchedulerNote />
        {seedError && (
          <Callout tone="warn" title="לא ניתן ליצור התראה מהחיפוש">
            {seedError}
          </Callout>
        )}
        {!editable && (
          <Callout tone="neutral" title="תצוגה בלבד">
            לחשבון שלך יש הרשאת צפייה — אפשר לראות התראות, אבל לא ליצור או לשנות אותן.
          </Callout>
        )}
        <QueryState
          query={query}
          loading={
            <div className="flex flex-col gap-4">
              <Skeleton className="h-40 w-full" />
              <Skeleton className="h-40 w-full" />
            </div>
          }
          isEmpty={(d) => d.length === 0}
          empty={
            <EmptyState
              icon={<Bell />}
              title="עוד אין התראות מחיר"
              description={editable ? 'צרו התראה לחיפוש שמעניין אתכם, או לחצו "התראה" בתוצאות חיפוש כדי ליצור אחת מהחיפוש עצמו.' : 'כשבני המשפחה ייצרו התראות הן יופיעו כאן.'}
              action={newButton}
            />
          }
        >
          {(alerts) => (
            <ul className="flex flex-col gap-4">
              {alerts.map((a) => (
                <li key={a.id}>
                  <AlertCard alert={a} editable={editable} showOwner={isOwner(user)} onEdit={setEditing} />
                </li>
              ))}
            </ul>
          )}
        </QueryState>
        <NotificationsList />
      </div>
      {editable && <AlertFormDialog open={creating} onOpenChange={closeCreate} seed={seed} />}
      {editable && editing && <AlertFormDialog open onOpenChange={(o) => !o && setEditing(null)} alert={editing} />}
    </>
  );
}
