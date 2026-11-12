import { FlaskConical } from 'lucide-react';
import { Link } from 'react-router';
import { Callout, PageHeader } from '@/components/ui';
import { useAuth } from '@/features/auth';
import { ProviderStatusWidget } from '@/features/dashboard/components/ProviderStatusWidget';
import { QuickSearch } from '@/features/dashboard/components/QuickSearch';
import { RecentSearchesWidget } from '@/features/dashboard/components/RecentSearchesWidget';
import { UpcomingTripsWidget } from '@/features/dashboard/components/UpcomingTripsWidget';
import { useDataModeSummary } from '@/features/providers/hooks';
import { formatDate } from '@/lib/format';

export function greeting(hour: number): string {
  if (hour >= 5 && hour < 12) return 'בוקר טוב';
  if (hour >= 12 && hour < 17) return 'צהריים טובים';
  if (hour >= 17 && hour < 22) return 'ערב טוב';
  return 'לילה טוב';
}

export default function DashboardPage() {
  const { user } = useAuth();
  const dataMode = useDataModeSummary();
  const now = new Date();
  const firstName = user?.display_name.trim().split(/\s+/)[0] ?? '';
  const today = formatDate(now.toISOString(), 'weekday-date');

  return (
    <>
      <PageHeader
        documentTitle="ראשי"
        eyebrow={today}
        title={firstName ? `${greeting(now.getHours())}, ${firstName}` : greeting(now.getHours())}
        description="מה מתכננים היום? חפשו, השוו ותכננו — עם שקיפות מלאה לגבי מקור כל מחיר."
      />

      <div className="flex flex-col gap-6">
        {dataMode.mode === 'DEMO' && (
          <Callout tone="neutral" icon={<FlaskConical />} title="המערכת פועלת כרגע עם נתוני הדגמה">
            הספקים, המחירים והזמינות בתוצאות אינם אמיתיים, וכל תוצאה מסומנת בתג "הדגמה".{' '}
            <Link to="/help#data-modes" className="font-medium text-accent underline-offset-4 hover:underline">
              מה זה אומר?
            </Link>
          </Callout>
        )}

        <QuickSearch />

        {/* grid-cols-1 = minmax(0,1fr): long nowrap titles must not widen the track (BUG-QA-02). */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 [&>*]:min-w-0">
          <RecentSearchesWidget />
          <UpcomingTripsWidget />
        </div>

        <ProviderStatusWidget />
      </div>
    </>
  );
}
