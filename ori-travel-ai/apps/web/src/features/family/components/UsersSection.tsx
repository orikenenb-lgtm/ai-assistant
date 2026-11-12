import { Users } from 'lucide-react';
import { QueryState } from '@/components/QueryState';
import { Badge, Card, CardHeader, Checkbox, DateText, Switch, useToast, NativeSelect } from '@/components/ui';
import { useAuth } from '@/features/auth';
import { errorMessage } from '@/lib/api';
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from '@/lib/labels';
import { ROLES, type Role, type User } from '@/lib/schemas/auth';
import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button, ConfirmDialog } from '@/components/ui';
import { useDeleteUser, useFamilyUsers, useUpdateUser } from '../hooks';
import { useReauth } from '../useReauth';

function UserRow({ u, isSelf }: { u: User; isSelf: boolean }) {
  const { toast } = useToast();
  const update = useUpdateUser();
  const del = useDeleteUser();
  const { withReauth, dialog } = useReauth();
  const [deleting, setDeleting] = useState(false);
  const change = (body: Record<string, unknown>, ok: string) =>
    update.mutate(
      { id: u.id, body },
      {
        onSuccess: () => toast({ title: ok, tone: 'success' }),
        onError: (e) => toast({ title: 'לא ניתן לבצע את השינוי', description: errorMessage(e), tone: 'danger' }),
      },
    );
  return (
    <li className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 lg:flex-row lg:items-center lg:gap-6" data-testid="user-row" data-user-id={u.id}>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 font-medium text-fg">
          {u.display_name}
          {isSelf && <Badge tone="accent" size="sm">את/ה</Badge>}
          {!u.is_active && <Badge tone="muted" size="sm">מושבת</Badge>}
        </p>
        <p className="text-sm text-fg-muted" dir="ltr" style={{ textAlign: 'start' }}>
          {u.email}
        </p>
        <p className="text-xs text-fg-subtle">
          התחברות אחרונה: <DateText value={u.last_login_at} preset="datetime" fallback="טרם התחבר/ה" />
        </p>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-5">
        <label className="flex flex-col gap-1 text-xs text-fg-muted">
          תפקיד
          <NativeSelect
            aria-label={`תפקיד של ${u.display_name}`}
            value={u.role}
            disabled={update.isPending}
            className="h-9 min-w-36"
            onChange={(e) => change({ role: e.target.value }, 'התפקיד עודכן')}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r as Role]}
              </option>
            ))}
          </NativeSelect>
        </label>
        <Checkbox
          label="מבוגר/ת מעל 18 (הצהרה)"
          checked={u.legal_adult_attested}
          disabled={update.isPending}
          onChange={(e) => change({ legal_adult_attested: e.target.checked }, 'ההצהרה עודכנה')}
        />
        <Switch
          label="חשבון פעיל"
          checked={u.is_active}
          disabled={update.isPending}
          onCheckedChange={(v) => change({ is_active: v }, v ? 'החשבון הופעל' : 'החשבון הושבת והמכשירים נותקו')}
        />
        {!u.is_active && u.role !== 'owner' && !isSelf && (
          <Button size="sm" variant="danger" leadingIcon={<Trash2 aria-hidden="true" />} onClick={() => setDeleting(true)}>
            מחיקת משתמש לצמיתות
          </Button>
        )}
      </div>
      {dialog}
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title="מחיקת משתמש לצמיתות"
        description={`למחוק לצמיתות את החשבון של ${u.display_name}? החשבון וההתחברויות שלו יימחקו ואי אפשר לבטל. רשומת בן/בת המשפחה נשארת במשפחה ללא חשבון מקושר, וטיולים והצעות שמורות אינם נמחקים. המחיקה דורשת אימות סיסמה מחדש.`}
        confirmLabel="מחיקה לצמיתות"
        tone="danger"
        onConfirm={async () => {
          await withReauth(() => del.mutateAsync(u.id));
          toast({ title: 'המשתמש נמחק', tone: 'success' });
        }}
      />
    </li>
  );
}

export function UsersSection() {
  const { user } = useAuth();
  const query = useFamilyUsers(true);
  return (
    <Card>
      <CardHeader
        title="משתמשים וגישה"
        description="רק בעל החשבון רואה ומשנה את זה. תפקיד 'מבוגר' או 'בעלים' דורש הצהרה שהמשתמש/ת מעל גיל 18."
        icon={<Users />}
      />
      <details className="mb-4 text-sm text-fg-muted">
        <summary className="cursor-pointer font-medium text-accent">מה ההבדל בין התפקידים?</summary>
        <ul className="mt-2 flex flex-col gap-1">
          {ROLES.map((r) => (
            <li key={r}>
              <strong className="text-fg">{ROLE_LABELS[r]}</strong> — {ROLE_DESCRIPTIONS[r]}
            </li>
          ))}
        </ul>
      </details>
      <QueryState query={query} errorTitle="לא ניתן לטעון את המשתמשים">
        {(users) => (
          <ul className="flex flex-col divide-y divide-line">
            {users.map((u) => (
              <UserRow key={u.id} u={u} isSelf={u.id === user?.id} />
            ))}
          </ul>
        )}
      </QueryState>
    </Card>
  );
}
