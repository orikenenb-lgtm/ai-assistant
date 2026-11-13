import { Map as MapIcon } from 'lucide-react';
import { lazy, Suspense } from 'react';
import { Link } from 'react-router';
import { Card, CardHeader, Skeleton } from '@/components/ui';
import { useSettings } from '@/features/settings/hooks';
import type { TripItem } from '@/lib/schemas/trips';

const TripMap = lazy(() => import('./TripMap'));

/** Map is opt-in (privacy): tiles are requested from OpenStreetMap only when enabled in settings. */
export function TripMapPanel({ items }: { items: TripItem[] }) {
  const settings = useSettings();
  if (settings.isPending) return null;
  const enabled = settings.data?.map.enabled === true;
  return (
    <Card>
      <CardHeader title="מפה" icon={<MapIcon />} />
      {enabled ? (
        <>
          <Suspense fallback={<Skeleton className="h-[280px] w-full" />}>
            <TripMap items={items} />
          </Suspense>
          <p className="mt-2 text-xs text-fg-subtle">הדפדפן טוען אריחי מפה מ-OpenStreetMap. © OpenStreetMap contributors</p>
        </>
      ) : (
        <p className="text-sm text-fg-muted">
          המפה כבויה כדי לא לשלוח בקשות לשרתים חיצוניים. בעל החשבון יכול להפעיל אותה ב<Link to="/settings" className="text-accent underline-offset-4 hover:underline">הגדרות</Link>.
        </p>
      )}
    </Card>
  );
}
