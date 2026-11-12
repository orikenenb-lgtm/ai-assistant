import { Lock, Pencil, Trash2, UserRound } from 'lucide-react';
import { useState } from 'react';
import { Badge, Button, Callout, ConfirmDialog, Dialog, EmptyState, Skeleton } from '@/components/ui';
import { DateText } from '@/components/ui';
import { useDeleteTraveler, useTraveler } from '@/features/travelers/hooks';
import { isApiError } from '@/lib/api';
import type { Member, TravelerDetail } from '@/lib/schemas/family';
import { GENDER_LABELS, MEAL_LABELS, SEAT_LABELS } from '../labels';
import { PassportReveal } from './PassportReveal';
import { TravelerForm } from './TravelerForm';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-4">
      <dt className="w-40 shrink-0 text-sm text-fg-muted">{label}</dt>
      <dd className="min-w-0 text-sm text-fg">{children}</dd>
    </div>
  );
}

const dash = <span className="text-fg-subtle">—</span>;

function ProfileView({ member, t, editable }: { member: Member; t: TravelerDetail; editable: boolean }) {
  const full = t.detail_level === 'full';
  return (
    <dl className="flex flex-col gap-2.5" data-testid="traveler-view" data-level={t.detail_level}>
      {full && (
        <>
          <Row label="שם בדרכון">
            <span dir="ltr">
              {t.legal_first_name} {t.legal_last_name}
            </span>
          </Row>
          <Row label="תאריך לידה">
            <DateText value={t.date_of_birth} />
          </Row>
        </>
      )}
      <Row label="מספר דרכון">
        {t.has_passport ? (
          editable ? (
            <PassportReveal key={member.id} memberId={member.id} masked={t.passport_masked} />
          ) : (
            <span className="font-mono" dir="ltr">
              {t.passport_masked ?? '••••••'}
            </span>
          )
        ) : (
          <span className="text-fg-muted">לא נשמר</span>
        )}
      </Row>
      <Row label="תוקף הדרכון">
        {full && t.passport_expiry ? <DateText value={t.passport_expiry} /> : t.passport_expiry_month ? <span dir="ltr">{t.passport_expiry_month}</span> : dash}
      </Row>
      <Row label="נתינות">{t.nationality ? <span dir="ltr">{t.nationality}</span> : dash}</Row>
      {full && <Row label="מגדר">{t.gender ? (GENDER_LABELS[t.gender] ?? t.gender) : dash}</Row>}
      <Row label="העדפת מושב">{t.seat_preference ? (SEAT_LABELS[t.seat_preference] ?? t.seat_preference) : dash}</Row>
      <Row label="העדפת ארוחה">{t.meal_preference ? (MEAL_LABELS[t.meal_preference] ?? t.meal_preference) : dash}</Row>
      <Row label="כשרות">{t.kosher_required ? <Badge tone="success">נדרש אוכל כשר</Badge> : 'ללא דרישה'}</Row>
      <Row label="נגישות">{t.accessibility_needs.length ? t.accessibility_needs.join(', ') : dash}</Row>
      {full && <Row label="מועדון טיסה">{t.has_frequent_flyer ? 'נשמר מספר (מוצפן)' : dash}</Row>}
      {full && <Row label="הערות">{t.notes ? <span className="whitespace-pre-line">{t.notes}</span> : dash}</Row>}
    </dl>
  );
}

export interface TravelerDialogProps {
  member: Member | null;
  editable: boolean;
  onOpenChange: (open: boolean) => void;
}

export function TravelerDialog({ member, editable, onOpenChange }: TravelerDialogProps) {
  return (
    <Dialog
      open={!!member}
      onOpenChange={onOpenChange}
      size="lg"
      title={member ? `פרופיל נוסע — ${member.display_name}` : 'פרופיל נוסע'}
      description="פרטי הזיהוי והדרכון נשמרים מוצפנים בשרת, ומספר הדרכון מוסתר כברירת מחדל."
    >
      {member && <DialogBody key={member.id} member={member} editable={editable} onClose={() => onOpenChange(false)} />}
    </Dialog>
  );
}

function DialogBody({ member, editable, onClose }: { member: Member; editable: boolean; onClose: () => void }) {
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const query = useTraveler(member.id, member.has_traveler_profile);
  const del = useDeleteTraveler(member.id);

  const privacy = (
    <Callout tone="neutral" icon={<Lock />} title="פרטיות">
      שם בדרכון, תאריך לידה, מספר דרכון ומספר מועדון טיסה מוצפנים במסד הנתונים. רק בעלי הרשאת עריכה רואים פרטים מלאים, וכל הצגה של מספר דרכון נרשמת ביומן. הנתונים אינם נשלחים לספקים בחיפוש — רק בהכנת הזמנה, באישורכם.
    </Callout>
  );

  if (!member.has_traveler_profile && !editing) {
    return (
      <div className="flex flex-col gap-4">
        {privacy}
        <EmptyState
          compact
          icon={<UserRound />}
          title="אין עדיין פרופיל נוסע"
          description="פרופיל נוסע שומר שם כמו בדרכון, תאריך לידה, העדפות ופרטי דרכון להכנת הזמנות."
          action={editable ? <Button onClick={() => setEditing(true)}>יצירת פרופיל</Button> : undefined}
        />
      </div>
    );
  }

  if (editing) {
    return (
      <div className="flex flex-col gap-4">
        {privacy}
        <TravelerForm memberId={member.id} traveler={query.data} onDone={() => setEditing(false)} />
      </div>
    );
  }

  if (query.isPending) return <Skeleton className="h-64 w-full" />;
  if (query.isError) {
    const unavailable = isApiError(query.error) && query.error.status === 503;
    return (
      <div className="flex flex-col gap-3">
        <Callout tone={unavailable ? 'warn' : 'danger'} role="alert" title={unavailable ? 'ההצפנה אינה זמינה' : 'לא ניתן לטעון את הפרופיל'}>
          {unavailable
            ? 'מפתח ההצפנה של השרת אינו מוגדר, ולכן אי אפשר לקרוא פרטים מוצפנים. בעל החשבון צריך להגדיר את ORI_DATA_KEY בהגדרות השרת ולהפעיל אותו מחדש.'
            : isApiError(query.error)
              ? query.error.message
              : 'נסו שוב.'}
        </Callout>
        <Button variant="secondary" onClick={() => void query.refetch()}>
          ניסיון חוזר
        </Button>
      </div>
    );
  }

  const t = query.data;
  return (
    <div className="flex flex-col gap-4">
      {privacy}
      {t.detail_level === 'masked' && (
        <Callout tone="info">לחשבון שלך יש הרשאת צפייה — מוצגים רק פרטים מוסתרים. שם בדרכון, תאריך לידה ומספר דרכון גלויים לבעלי הרשאת עריכה.</Callout>
      )}
      <ProfileView member={member} t={t} editable={editable && t.detail_level === 'full'} />
      <div className="flex flex-wrap justify-between gap-2 border-t border-line pt-4">
        <p className="text-xs text-fg-subtle">
          עודכן <DateText value={t.updated_at} preset="datetime" />
        </p>
        <div className="flex gap-2">
          {editable && (
            <>
              <Button variant="ghost" leadingIcon={<Trash2 aria-hidden="true" />} onClick={() => setDeleting(true)}>
                מחיקת הפרופיל
              </Button>
              <Button variant="secondary" leadingIcon={<Pencil aria-hidden="true" />} onClick={() => setEditing(true)}>
                עריכה
              </Button>
            </>
          )}
          <Button variant="secondary" onClick={onClose}>
            סגירה
          </Button>
        </div>
      </div>
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title="מחיקת פרופיל נוסע"
        description={`הפרופיל של ${member.display_name} יימחק לצמיתות, כולל פרטי הדרכון המוצפנים. בן/בת המשפחה יישארו ברשימה.`}
        confirmLabel="מחיקת הפרופיל"
        tone="danger"
        onConfirm={async () => {
          await del.mutateAsync();
          onClose();
        }}
      />
    </div>
  );
}
