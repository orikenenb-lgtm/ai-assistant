import { ArrowRight, CalendarDays, Download, FileText, Pencil, Plus, Trash2, Users } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { QueryState } from '@/components/QueryState';
import { Badge, Button, Callout, Card, CardHeader, ConfirmDialog, DateRange, PageHeader, Skeleton, useToast } from '@/components/ui';
import { canEdit, useAuth } from '@/features/auth';
import { exportUrl } from '@/features/trips/api';
import { BudgetPanel } from '@/features/trips/components/BudgetPanel';
import { ItemFormDialog } from '@/features/trips/components/ItemFormDialog';
import { Timeline } from '@/features/trips/components/Timeline';
import { TripFormDialog } from '@/features/trips/components/TripFormDialog';
import { TripMapPanel } from '@/features/trips/components/TripMapPanel';
import { useDeleteTrip, useTrip } from '@/features/trips/hooks';
import { tripStatusLabel } from '@/features/trips/labels';
import type { TripDetail } from '@/lib/schemas/trips';

export default function TripDetailPage() {
  const { tripId = '' } = useParams();
  const query = useTrip(tripId);
  return (
    <QueryState
      query={query}
      compact={false}
      errorTitle="לא ניתן לטעון את הטיול"
      loading={
        <div className="flex flex-col gap-4">
          <Skeleton className="h-10 w-1/2" />
          <Skeleton className="h-64 w-full" />
        </div>
      }
      unavailable={
        <Callout tone="warn" title="הטיול לא נמצא">
          ייתכן שהוא נמחק. <Link to="/trips" className="font-medium text-accent underline-offset-4 hover:underline">חזרה לכל הטיולים</Link>
        </Callout>
      }
    >
      {(trip) => <TripView trip={trip} />}
    </QueryState>
  );
}

function TripView({ trip }: { trip: TripDetail }) {
  const { user } = useAuth();
  const editable = canEdit(user);
  const navigate = useNavigate();
  const { toast } = useToast();
  const del = useDeleteTrip();
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState(false);

  return (
    <>
      <PageHeader
        title={trip.title}
        eyebrow={
          <Link to="/trips" className="inline-flex items-center gap-1 text-accent underline-offset-4 hover:underline">
            <ArrowRight className="size-3.5" aria-hidden="true" />
            כל הטיולים
          </Link>
        }
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {trip.destination && <span>{trip.destination}</span>}
            {trip.start_date && (
              <span className="inline-flex items-center gap-1">
                <CalendarDays className="size-4" aria-hidden="true" />
                <DateRange start={trip.start_date} end={trip.end_date} />
              </span>
            )}
            {trip.status && <Badge tone="info">{tripStatusLabel(trip.status)}</Badge>}
            {trip.has_demo_data && <Badge tone="demo">כולל נתוני הדגמה</Badge>}
          </span>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={exportUrl(trip.id, 'ics')}
              download
              className="inline-flex h-10 items-center gap-2 rounded-md border border-line-strong bg-surface px-4 text-sm font-medium text-fg shadow-xs hover:bg-sand-50"
            >
              <Download className="size-4" aria-hidden="true" />
              ייצוא ליומן (ICS)
            </a>
            <a
              href={exportUrl(trip.id, 'pdf')}
              download
              className="inline-flex h-10 items-center gap-2 rounded-md border border-line-strong bg-surface px-4 text-sm font-medium text-fg shadow-xs hover:bg-sand-50"
            >
              <FileText className="size-4" aria-hidden="true" />
              ייצוא ל-PDF
            </a>
            {editable && (
              <>
                <Button variant="secondary" leadingIcon={<Pencil aria-hidden="true" />} onClick={() => setEditing(true)}>
                  עריכה
                </Button>
                <Button variant="ghost" leadingIcon={<Trash2 aria-hidden="true" />} onClick={() => setDeleting(true)}>
                  מחיקה
                </Button>
              </>
            )}
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <section aria-labelledby="travelers-heading" className="flex flex-wrap items-center gap-2">
            <h2 id="travelers-heading" className="flex items-center gap-2 text-sm font-semibold text-fg">
              <Users className="size-4 text-fg-subtle" aria-hidden="true" />
              נוסעים
            </h2>
            {trip.travelers.length === 0 ? (
              <span className="text-sm text-fg-muted">לא שויכו נוסעים{editable ? ' — אפשר להוסיף בעריכת הטיול' : ''}</span>
            ) : (
              <ul className="flex flex-wrap gap-1.5">
                {trip.travelers.map((t) => (
                  <li key={t.id}>
                    <Badge tone="neutral">
                      {t.display_name}
                      {t.is_minor && <span className="text-fg-subtle">· קטין/ה</span>}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {!editable && (
            <Callout tone="neutral" title="תצוגה בלבד">
              לחשבון שלך יש הרשאת צפייה — אפשר לראות את הטיול ולהוריד אותו, אבל לא לערוך.
            </Callout>
          )}

          <section aria-labelledby="timeline-heading">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 id="timeline-heading" className="text-lg font-semibold text-fg">
                מסלול
              </h2>
              {editable && (
                <Button size="sm" variant="secondary" leadingIcon={<Plus aria-hidden="true" />} onClick={() => setAdding(true)}>
                  פריט ידני
                </Button>
              )}
            </div>
            <Timeline trip={trip} editable={editable} />
          </section>

          {trip.notes && (
            <Card>
              <CardHeader title="הערות" />
              <p className="whitespace-pre-line text-sm leading-relaxed text-fg-muted">{trip.notes}</p>
            </Card>
          )}
        </div>

        <aside className="flex min-w-0 flex-col gap-6" aria-label="תקציב ומפה">
          <BudgetPanel tripId={trip.id} />
          <TripMapPanel items={trip.items} />
        </aside>
      </div>

      {editable && <TripFormDialog open={editing} onOpenChange={setEditing} trip={trip} />}
      {editable && <ItemFormDialog open={adding} onOpenChange={setAdding} trip={trip} />}
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title="מחיקת טיול"
        description={`למחוק את "${trip.title}" וכל ${trip.items.length} הפריטים שבו? אי אפשר לבטל. ההצעות השמורות והחיפושים לא יימחקו.`}
        confirmLabel="מחיקת הטיול"
        tone="danger"
        onConfirm={async () => {
          await del.mutateAsync(trip.id);
          toast({ title: 'הטיול נמחק', tone: 'success' });
          navigate('/trips');
        }}
      />
    </>
  );
}
