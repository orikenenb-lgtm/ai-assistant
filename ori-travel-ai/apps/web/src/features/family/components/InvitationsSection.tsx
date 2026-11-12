import { Check, Copy, Link2, Mail, Plus, TriangleAlert } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';
import { QueryState } from '@/components/QueryState';
import { Badge, Button, Callout, Card, CardHeader, Checkbox, ConfirmDialog, DateText, Dialog, EmptyState, Field, Input, NativeSelect } from '@/components/ui';
import { serverFieldErrors } from '@/features/trips/formUtils';
import { errorMessage, isApiError } from '@/lib/api';
import { ROLE_LABELS } from '@/lib/labels';
import { ROLES, type Role } from '@/lib/schemas/auth';
import type { Invitation, InvitationCreated, Member } from '@/lib/schemas/family';
import { useCreateInvitation, useInvitations, useMembers, useRevokeInvitation } from '../hooks';
import { INVITATION_STATUS_LABELS, INVITATION_STATUS_TONES } from '../labels';

export function inviteUrl(invitePath: string): string {
  return `${window.location.origin}${invitePath}`;
}

function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      input.current?.select();
    }
  }
  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <Input ref={input} readOnly value={url} dir="ltr" className="text-start" aria-label="קישור ההזמנה" onFocus={(e) => e.currentTarget.select()} />
      <Button variant="secondary" leadingIcon={copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />} onClick={() => void copy()}>
        {copied ? 'הועתק' : 'העתקה'}
      </Button>
    </div>
  );
}

function CreateInvitationDialog({
  open,
  onOpenChange,
  members,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  members: Member[];
  onCreated: (c: InvitationCreated) => void;
}) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>('adult');
  const [attested, setAttested] = useState(false);
  const [memberId, setMemberId] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const create = useCreateInvitation();
  const serverErrors = serverFieldErrors(create.error);
  const needsAttestation = role === 'adult' || role === 'owner';
  const free = members.filter((m) => !m.user);
  const minorError = isApiError(create.error) && create.error.code === 'MINOR_CANNOT_BE_ADULT';

  function reset() {
    setEmail('');
    setName('');
    setRole('adult');
    setAttested(false);
    setMemberId('');
    setErrors({});
    create.reset();
  }

  function submit(ev: FormEvent) {
    ev.preventDefault();
    const found: Record<string, string> = {};
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) found.email = 'כתובת אימייל לא תקינה';
    if (!name.trim()) found.display_name = 'יש להזין שם';
    if (needsAttestation && !attested) found.attested = 'נדרשת הצהרה שהמוזמן/ת מעל גיל 18';
    setErrors(found);
    if (Object.keys(found).length) return;
    create.mutate(
      {
        email: email.trim(),
        display_name: name.trim(),
        role,
        legal_adult_attested: needsAttestation ? attested : false,
        ...(memberId ? { family_member_id: memberId } : {}),
      },
      {
        onSuccess: (c) => {
          reset();
          onOpenChange(false);
          onCreated(c);
        },
      },
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
      title="הזמנת בן/בת משפחה"
      description="ניצור קישור הרשמה חד-פעמי. המוזמן/ת בוחר/ת סיסמה בעצמו/ה. המערכת לא שולחת אימייל — אתם מעבירים את הקישור."
    >
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <Field label="אימייל" required error={errors.email ?? serverErrors.email}>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} dir="ltr" className="text-start" autoComplete="off" />
        </Field>
        <Field label="שם" required error={errors.display_name ?? serverErrors.display_name}>
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoComplete="off" />
        </Field>
        <Field label="תפקיד">
          <NativeSelect value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </NativeSelect>
        </Field>
        {free.length > 0 && (
          <Field label="קישור לבן/בת משפחה קיימ/ת" optional hint="המשתמש/ת החדש/ה יקושר/ת לפרופיל המשפחתי הזה." error={minorError ? errorMessage(create.error) : undefined}>
            <NativeSelect value={memberId} onChange={(e) => setMemberId(e.target.value)}>
              <option value="">ללא קישור</option>
              {free.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.display_name}
                </option>
              ))}
            </NativeSelect>
          </Field>
        )}
        {needsAttestation && (
          <Checkbox
            label="אני מצהיר/ה שהמוזמן/ת הוא/היא מעל גיל 18"
            description="נדרש לתפקיד 'מבוגר' או 'בעלים' — מבוגרים יכולים לערוך טיולים ולהכין הזמנות."
            checked={attested}
            onChange={(e) => setAttested(e.target.checked)}
            error={errors.attested}
          />
        )}
        {create.isError && !minorError && (
          <Callout tone="danger" role="alert">
            {errorMessage(create.error)}
          </Callout>
        )}
        <div className="flex flex-wrap-reverse justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            ביטול
          </Button>
          <Button type="submit" loading={create.isPending}>
            יצירת קישור הזמנה
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function InvitationsSection() {
  const query = useInvitations(true);
  const members = useMembers();
  const revoke = useRevokeInvitation();
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<InvitationCreated | null>(null);
  const [revoking, setRevoking] = useState<Invitation | null>(null);

  return (
    <Card>
      <CardHeader
        title="הזמנות"
        description="קישורי הרשמה לבני משפחה חדשים"
        icon={<Mail />}
        actions={
          <Button size="sm" leadingIcon={<Plus aria-hidden="true" />} onClick={() => setCreating(true)}>
            הזמנה חדשה
          </Button>
        }
      />
      <QueryState
        query={query}
        errorTitle="לא ניתן לטעון את ההזמנות"
        isEmpty={(d) => d.length === 0}
        empty={<EmptyState compact icon={<Mail />} title="אין הזמנות" description="הזמינו בן/בת משפחה כדי שיוכלו להתחבר ולהשתתף בתכנון." />}
      >
        {(list) => (
          <ul className="flex flex-col divide-y divide-line" data-testid="invitations-list">
            {list.map((inv) => (
              <li key={inv.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-fg">
                    {inv.display_name} <span className="text-sm font-normal text-fg-muted">· {ROLE_LABELS[inv.role as Role] ?? inv.role}</span>
                  </p>
                  <p className="text-sm text-fg-muted" dir="ltr" style={{ textAlign: 'start' }}>
                    {inv.email}
                  </p>
                  <p className="text-xs text-fg-subtle">
                    {inv.status === 'pending' ? 'תקפה עד ' : 'נוצרה '}
                    <DateText value={inv.status === 'pending' ? inv.expires_at : inv.created_at} preset="datetime" />
                  </p>
                </div>
                <Badge tone={INVITATION_STATUS_TONES[inv.status]}>{INVITATION_STATUS_LABELS[inv.status]}</Badge>
                {inv.status === 'pending' && (
                  <Button size="sm" variant="ghost" onClick={() => setRevoking(inv)}>
                    ביטול ההזמנה
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </QueryState>

      <CreateInvitationDialog open={creating} onOpenChange={setCreating} members={members.data ?? []} onCreated={setCreated} />

      <Dialog
        open={!!created}
        onOpenChange={(o) => !o && setCreated(null)}
        title="קישור ההזמנה מוכן"
        description={created ? `ההזמנה ל${created.invitation.display_name} נוצרה.` : undefined}
        footer={<Button onClick={() => setCreated(null)}>סיימתי, סגירה</Button>}
      >
        {created && (
          <div className="flex flex-col gap-4">
            <Callout tone="warn" icon={<TriangleAlert />} title="הקישור מוצג פעם אחת בלבד">
              מסיבות אבטחה השרת שומר רק גיבוב של הקישור, ואי אפשר לשחזר אותו. העתיקו אותו עכשיו ושלחו אותו ישירות למוזמן/ת. מי שמחזיק/ה בקישור יכול/ה להירשם עד שיפוג או יבוטל.
            </Callout>
            <div className="flex flex-col gap-2">
              <p className="flex items-center gap-2 text-sm font-medium text-fg">
                <Link2 className="size-4 text-fg-subtle" aria-hidden="true" />
                קישור הרשמה
              </p>
              <CopyLink url={inviteUrl(created.invite_path)} />
              <p className="text-xs text-fg-subtle">
                תוקף עד <DateText value={created.invitation.expires_at} preset="datetime" />
              </p>
            </div>
          </div>
        )}
      </Dialog>

      <ConfirmDialog
        open={!!revoking}
        onOpenChange={(o) => !o && setRevoking(null)}
        title="ביטול הזמנה"
        description={revoking ? `לבטל את ההזמנה של ${revoking.display_name}? הקישור יפסיק לעבוד.` : undefined}
        confirmLabel="ביטול ההזמנה"
        tone="danger"
        onConfirm={async () => {
          if (revoking) await revoke.mutateAsync(revoking.id);
        }}
      />
    </Card>
  );
}
