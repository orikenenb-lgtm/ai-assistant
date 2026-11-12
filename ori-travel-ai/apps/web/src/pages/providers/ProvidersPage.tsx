import { Plug } from 'lucide-react';
import { Link } from 'react-router';
import { QueryState } from '@/components/QueryState';
import { Callout, Card, CardHeader, PageHeader, Skeleton, Stat } from '@/components/ui';
import { canEdit, isOwner, useAuth } from '@/features/auth';
import { DiagnosticsTable } from '@/features/providers/components/DiagnosticsTable';
import { ProviderCard } from '@/features/providers/components/ProviderCard';
import { useDiagnostics, useProviders } from '@/features/providers/hooks';
import { providerMode } from '@/lib/schemas/providers';

export default function ProvidersPage() {
  const { user } = useAuth();
  const editor = canEdit(user);
  const owner = isOwner(user);
  const providers = useProviders();
  const diagnostics = useDiagnostics(editor);

  return (
    <>
      <PageHeader
        title="ספקים ואבחון"
        icon={<Plug />}
        description="מי מספק את התוצאות, באיזה מצב נתונים, ומה מחובר. שקיפות מלאה: ספק שלא מחובר לא מציג תוצאות — ולא ממציאים במקומו."
      />
      <div className="flex flex-col gap-8">
        <Callout tone="info" title="מה זה ״לא מחובר״?">
          ספקים אמיתיים (למשל Duffel או Amadeus) דורשים פרטי גישה שמוגדרים בשרת בלבד. עד שהוגדרו הם מסומנים ״לא מחובר״ ולא מחזירים תוצאות. ספקי הדגמה מחזירים
          נתונים סינתטיים, ומסומנים תמיד ב״הדגמה״.{' '}
          <Link to="/help#providers" className="font-medium underline underline-offset-4">
            לעזרה בחיבור ספק
          </Link>
        </Callout>

        <QueryState
          query={providers}
          loading={
            <div className="grid gap-4 lg:grid-cols-2">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-56 w-full" />
              ))}
            </div>
          }
          compact={false}
        >
          {(list) => {
            const live = list.filter((p) => providerMode(p) === 'LIVE');
            const demo = list.filter((p) => providerMode(p) !== 'LIVE');
            const usable = list.filter((p) => p.enabled && p.configured && p.status === 'OK').length;
            const notConfigured = list.filter((p) => p.status === 'NOT_CONFIGURED').length;
            return (
              <>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Stat label="ספקים במערכת" value={list.length} />
                  <Stat label="פעילים ותקינים" value={usable} tone="accent" />
                  <Stat label="לא מחוברים" value={notConfigured} hint="חסרים פרטי גישה" />
                </div>
                {[
                  { id: 'live', title: 'ספקים אמיתיים', hint: 'נתונים חיים — כשהם מחוברים', items: live },
                  { id: 'demo', title: 'ספקי הדגמה', hint: 'נתונים סינתטיים, לא ניתנים להזמנה', items: demo },
                ]
                  .filter((g) => g.items.length > 0)
                  .map((g) => (
                    <section key={g.id} aria-labelledby={`grp-${g.id}`} className="flex flex-col gap-3">
                      <div>
                        <h2 id={`grp-${g.id}`} className="text-lg font-bold text-fg">
                          {g.title} <span className="text-sm font-normal text-fg-muted">({g.items.length})</span>
                        </h2>
                        <p className="text-sm text-fg-muted">{g.hint}</p>
                      </div>
                      <div className="grid gap-4 lg:grid-cols-2">
                        {g.items.map((p) => (
                          <ProviderCard key={p.provider_id} provider={p} canCheck={editor} isOwner={owner} />
                        ))}
                      </div>
                    </section>
                  ))}
              </>
            );
          }}
        </QueryState>

        {editor ? (
          <section aria-label="אבחון ספקים">
            <Card padding="sm">
              <CardHeader
                level={2}
                title="אבחון ספקים"
                description={diagnostics.data ? `ביצועים ב-${diagnostics.data.window_days} הימים האחרונים` : 'ביצועים בחיפושים האחרונים'}
              />
              <QueryState
                query={diagnostics}
                loading={<Skeleton className="h-40 w-full" />}
                unavailable={<p className="text-sm text-fg-muted">האבחון עדיין לא זמין בשרת.</p>}
              >
                {(d) => <DiagnosticsTable rows={d.providers} windowDays={d.window_days} />}
              </QueryState>
            </Card>
          </section>
        ) : (
          <Callout tone="neutral" title="תצוגה בלבד">
            לצפיית אבחון מפורט ולהרצת בדיקות תקינות נדרשת הרשאת עריכה. הפעלה והשבתה של ספקים — בעלים בלבד.
          </Callout>
        )}
      </div>
    </>
  );
}
