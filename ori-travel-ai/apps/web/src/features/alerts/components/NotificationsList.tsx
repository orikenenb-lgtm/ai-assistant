import { BellRing, CheckCheck } from 'lucide-react';
import { Link } from 'react-router';
import { QueryState } from '@/components/QueryState';
import { Badge, Button, Card, CardHeader, DateText, EmptyState } from '@/components/ui';
import { useMarkAllNotificationsRead, useMarkNotificationRead } from '@/features/notifications/hooks';
import { useNotificationsList } from '../hooks';

function safeInternalLink(link: string | null | undefined): string | null {
  return link && link.startsWith('/') && !link.startsWith('//') ? link : null;
}

export function NotificationsList() {
  const query = useNotificationsList();
  const markOne = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();
  const unread = query.data?.items.filter((n) => !n.read_at).length ?? 0;
  return (
    <Card>
      <CardHeader
        title="התראות שהתקבלו"
        description="עדכונים על מחירים שהגיעו ליעד ועל בדיקות שנכשלו"
        icon={<BellRing />}
        actions={
          unread > 0 ? (
            <Button size="sm" variant="secondary" leadingIcon={<CheckCheck aria-hidden="true" />} loading={markAll.isPending} onClick={() => markAll.mutate()}>
              סימון הכול כנקרא
            </Button>
          ) : null
        }
      />
      <QueryState
        query={query}
        isEmpty={(d) => d.items.length === 0}
        empty={<EmptyState compact icon={<BellRing />} title="אין התראות חדשות" description="כשמחיר יגיע ליעד שהגדרתם, ההודעה תופיע כאן." />}
      >
        {(page) => (
          <ul className="flex flex-col divide-y divide-line" data-testid="notifications-list">
            {page.items.map((n) => {
              const link = safeInternalLink(n.link);
              return (
                <li key={n.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                  <span className={`mt-2 size-2 shrink-0 rounded-full ${n.read_at ? 'bg-ink-200' : 'bg-sea-600'}`} aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-fg">
                      {n.title}
                      {!n.read_at && <Badge tone="accent" size="sm">חדש</Badge>}
                    </p>
                    {n.body && <p className="text-sm text-fg-muted">{n.body}</p>}
                    <p className="mt-0.5 flex flex-wrap items-center gap-3 text-xs text-fg-subtle">
                      <DateText value={n.created_at} preset="datetime" />
                      {link && (
                        <Link to={link} className="text-accent underline-offset-4 hover:underline">
                          פתיחה
                        </Link>
                      )}
                    </p>
                  </div>
                  {!n.read_at && (
                    <Button size="sm" variant="ghost" loading={markOne.isPending && markOne.variables === n.id} onClick={() => markOne.mutate(n.id)}>
                      סימון כנקרא
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </QueryState>
    </Card>
  );
}
