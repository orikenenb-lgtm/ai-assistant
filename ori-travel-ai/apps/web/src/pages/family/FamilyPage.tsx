import { Plus, ShieldCheck, Users } from 'lucide-react';
import { useState } from 'react';
import { QueryState } from '@/components/QueryState';
import { Button, Callout, ConfirmDialog, EmptyState, PageHeader, Skeleton } from '@/components/ui';
import { canEdit, isOwner, useAuth } from '@/features/auth';
import { InvitationsSection } from '@/features/family/components/InvitationsSection';
import { MemberCard } from '@/features/family/components/MemberCard';
import { MemberFormDialog } from '@/features/family/components/MemberFormDialog';
import { TravelerDialog } from '@/features/family/components/TravelerDialog';
import { UsersSection } from '@/features/family/components/UsersSection';
import { useDeleteMember, useMembers } from '@/features/family/hooks';
import type { Member } from '@/lib/schemas/family';

export default function FamilyPage() {
  const { user } = useAuth();
  const editable = canEdit(user);
  const owner = isOwner(user);
  const query = useMembers();
  const del = useDeleteMember();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Member | undefined>(undefined);
  const [profile, setProfile] = useState<Member | null>(null);
  const [deleting, setDeleting] = useState<Member | null>(null);

  const addButton = editable ? (
    <Button
      leadingIcon={<Plus aria-hidden="true" />}
      onClick={() => {
        setEditing(undefined);
        setFormOpen(true);
      }}
    >
      בן/בת משפחה
    </Button>
  ) : null;

  return (
    <>
      <PageHeader
        title="משפחה"
        description="בני המשפחה המשתתפים בטיולים, פרופילי נוסעים והגישה למערכת."
        icon={<Users />}
        actions={addButton}
      />
      <div className="flex flex-col gap-8">
        <section aria-labelledby="members-heading" className="flex flex-col gap-4">
          <h2 id="members-heading" className="text-lg font-semibold text-fg">
            בני משפחה
          </h2>
          <Callout tone="neutral" icon={<ShieldCheck />}>
            פרטי זיהוי ודרכון נשמרים מוצפנים ונחשפים רק לבעלי הרשאת עריכה. הם לא נשלחים לספקי חיפוש.
          </Callout>
          <QueryState
            query={query}
            loading={
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-40 w-full" />
                ))}
              </div>
            }
            isEmpty={(d) => d.length === 0}
            empty={<EmptyState icon={<Users />} title="עוד אין בני משפחה" description="הוסיפו את בני המשפחה כדי לשייך אותם לטיולים ולשמור את העדפות הנסיעה שלהם." action={addButton} />}
          >
            {(members) => (
              <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {members.map((m) => (
                  <li key={m.id} className="contents">
                    <MemberCard
                      member={m}
                      canEdit={editable}
                      canDelete={owner}
                      onProfile={() => setProfile(m)}
                      onEdit={() => {
                        setEditing(m);
                        setFormOpen(true);
                      }}
                      onDelete={() => setDeleting(m)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </QueryState>
        </section>

        {owner ? (
          <>
            <UsersSection />
            <InvitationsSection />
          </>
        ) : (
          <Callout tone="neutral" title="ניהול משתמשים והזמנות">
            הוספת משתמשים, שינוי תפקידים והזמנות זמינים לבעל החשבון בלבד.
          </Callout>
        )}
      </div>

      {editable && <MemberFormDialog key={editing?.id ?? 'new'} open={formOpen} onOpenChange={setFormOpen} member={editing} />}
      <TravelerDialog member={profile} editable={editable} onOpenChange={(o) => !o && setProfile(null)} />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="מחיקת בן/בת משפחה"
        description={
          deleting
            ? `למחוק את ${deleting.display_name}? הפעולה תמחק גם את פרופיל הנוסע שלו/ה — כולל פרטי הדרכון המוצפנים — ותסיר אותו/ה מהטיולים. אי אפשר לבטל. חשבון משתמש מקושר לא נמחק.`
            : undefined
        }
        confirmLabel="מחיקה לצמיתות"
        tone="danger"
        onConfirm={async () => {
          if (deleting) await del.mutateAsync(deleting.id);
        }}
      />
    </>
  );
}
