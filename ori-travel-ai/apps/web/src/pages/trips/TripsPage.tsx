import { Luggage, Plus } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { QueryState } from '@/components/QueryState';
import { Button, EmptyState, PageHeader, Skeleton } from '@/components/ui';
import { canEdit, useAuth } from '@/features/auth';
import { TripCard } from '@/features/trips/components/TripCard';
import { TripFormDialog } from '@/features/trips/components/TripFormDialog';
import { useTrips } from '@/features/trips/hooks';

export default function TripsPage() {
  const { user } = useAuth();
  const editable = canEdit(user);
  const query = useTrips();
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();

  const newButton = editable ? (
    <Button leadingIcon={<Plus aria-hidden="true" />} onClick={() => setCreating(true)}>
      טיול חדש
    </Button>
  ) : null;

  return (
    <>
      <PageHeader
        title="טיולים"
        description="כל הטיולים של המשפחה במקום אחד — מסלול יומי, פריטים ותקציב לפי מטבע."
        icon={<Luggage />}
        actions={newButton}
      />
      <QueryState
        query={query}
        loading={
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-44 w-full" />
            ))}
          </div>
        }
        isEmpty={(d) => d.length === 0}
        empty={
          <EmptyState
            icon={<Luggage />}
            title="עוד אין טיולים"
            description={editable ? 'צרו את הטיול הראשון — עם יעד, תאריכים, נוסעים ותקציב — ואז הוסיפו אליו הצעות מהחיפוש.' : 'כשבני המשפחה ייצרו טיול, הוא יופיע כאן.'}
            action={newButton}
          />
        }
      >
        {(trips) => (
          <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {trips.map((t) => (
              <li key={t.id} className="contents">
                <TripCard trip={t} />
              </li>
            ))}
          </ul>
        )}
      </QueryState>
      <TripFormDialog open={creating} onOpenChange={setCreating} onSaved={(t) => navigate(`/trips/${encodeURIComponent(t.id)}`)} />
    </>
  );
}
