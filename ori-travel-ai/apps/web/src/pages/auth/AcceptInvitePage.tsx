import { useQuery } from '@tanstack/react-query';
import { Check, Circle, Eye, EyeOff, MailOpen, UserPlus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import { AuthLayout } from '@/components/layout/AuthLayout';
import {
  Badge,
  Button,
  ButtonLink,
  Callout,
  Card,
  DateText,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Skeleton,
  Spinner,
  useToast,
} from '@/components/ui';
import { useAuth } from '@/features/auth';
import { acceptInvitation, authKeys, previewInvitation } from '@/features/auth/api';
import { checkPassword, MIN_PASSWORD_LENGTH, passwordError } from '@/features/auth/passwordStrength';
import { isApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from '@/lib/labels';
import type { InvitationPreview } from '@/lib/schemas/auth';
import { useDocumentTitle } from '@/lib/useDocumentTitle';

const STRENGTH_LABELS = ['', 'חלשה', 'סבירה', 'טובה', 'חזקה'] as const;
const STRENGTH_COLORS = ['bg-ink-200', 'bg-coral-500', 'bg-amber-500', 'bg-sea-500', 'bg-moss-600'] as const;

function Requirement({ ok, children }: { ok: boolean; children: string }) {
  return (
    <li className={cn('flex items-center gap-2', ok ? 'text-moss-700' : 'text-fg-subtle')}>
      {ok ? <Check className="size-3.5" aria-hidden="true" /> : <Circle className="size-3" aria-hidden="true" />}
      <span>
        {children}
        <span className="sr-only">{ok ? ' — מתקיים' : ' — לא מתקיים'}</span>
      </span>
    </li>
  );
}

function AcceptForm({
  token,
  invitation,
  onJoined,
}: {
  token: string;
  invitation: InvitationPreview;
  onJoined: () => void;
}) {
  const { setSession } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [errors, setErrors] = useState<{ password?: string; confirm?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const check = checkPassword(password);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);
    const next: typeof errors = {};
    const pwErr = passwordError(password);
    if (pwErr) next.password = pwErr;
    if (!confirm) next.confirm = 'יש להזין את הסיסמה פעם נוספת';
    else if (confirm !== password) next.confirm = 'הסיסמאות אינן תואמות';
    setErrors(next);
    if (next.password || next.confirm) return;

    setSubmitting(true);
    try {
      const session = await acceptInvitation({ token, password });
      onJoined(); // batched with setSession: avoids flashing the "already signed in" notice
      setSession(session);
      toast({ tone: 'success', title: `ברוכים הבאים, ${session.user.display_name}!`, description: 'החשבון נוצר ואתם מחוברים.' });
      navigate('/', { replace: true });
    } catch (err) {
      if (isApiError(err) && err.code === 'WEAK_PASSWORD') setErrors({ password: err.message });
      else setFormError(isApiError(err) ? err.message : 'אירעה שגיאה בלתי צפויה. נסו שוב.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="mt-6 flex flex-col gap-4" noValidate onSubmit={onSubmit}>
      {formError && (
        <Callout tone="danger" title="לא ניתן היה להשלים את ההצטרפות" role="alert">
          {formError}
        </Callout>
      )}
      {/* Helps password managers associate the new password with the account */}
      <input type="email" name="username" autoComplete="username" value={invitation.email} readOnly hidden />
      <Field
        label="סיסמה חדשה"
        required
        error={errors.password}
        hint={
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2" aria-live="polite">
              <span className="flex h-1.5 flex-1 gap-1" aria-hidden="true">
                {[1, 2, 3, 4].map((i) => (
                  <span
                    key={i}
                    className={cn('flex-1 rounded-full transition-colors', check.score >= i ? STRENGTH_COLORS[check.score] : 'bg-ink-100')}
                  />
                ))}
              </span>
              {check.score > 0 && <span className="w-12 text-end text-xs font-medium">{STRENGTH_LABELS[check.score]}</span>}
            </div>
            <ul className="flex flex-col gap-1">
              <Requirement ok={password.length >= MIN_PASSWORD_LENGTH}>{`לפחות ${MIN_PASSWORD_LENGTH} תווים`}</Requirement>
              <Requirement ok={check.classesOk}>לפחות שני סוגי תווים: אותיות קטנות, גדולות, ספרות או סימנים</Requirement>
            </ul>
          </div>
        }
      >
        <div className="relative">
          <Input
            type={show ? 'text' : 'password'}
            name="new-password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="pe-11"
          />
          <button
            type="button"
            onClick={() => setShow((v) => !v)}
            className="absolute inset-y-0 end-0 grid w-10 place-items-center rounded-e-md text-fg-subtle hover:text-fg"
            aria-label={show ? 'הסתרת הסיסמה' : 'הצגת הסיסמה'}
            aria-pressed={show}
          >
            {show ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
          </button>
        </div>
      </Field>
      <Field label="אימות סיסמה" required error={errors.confirm}>
        <Input
          type={show ? 'text' : 'password'}
          name="confirm-password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
      </Field>
      <Button type="submit" size="lg" fullWidth loading={submitting} loadingText="יוצר חשבון…" leadingIcon={<UserPlus />} className="mt-2">
        יצירת סיסמה והצטרפות
      </Button>
    </form>
  );
}

export default function AcceptInvitePage() {
  useDocumentTitle('הצטרפות למשפחה');
  const { token = '' } = useParams();
  const { status, user, logout } = useAuth();
  const [joined, setJoined] = useState(false);
  const preview = useQuery({
    queryKey: authKeys.invitation(token),
    queryFn: () => previewInvitation(token),
    enabled: token.length >= 10,
    retry: false,
    staleTime: Infinity,
  });

  let body;
  if (joined) {
    body = (
      <Card padding="lg" className="flex flex-col items-center gap-3 text-center" role="status">
        <Spinner size="lg" decorative />
        <p className="font-semibold text-fg">ההצטרפות הושלמה — מעבירים אותך למסך הבית…</p>
      </Card>
    );
  } else if (token.length < 10 || (preview.isError && isApiError(preview.error) && preview.error.status === 404)) {
    body = (
      <EmptyState
        icon={<MailOpen />}
        title="ההזמנה אינה תקפה או שפג תוקפה"
        description="קישורי הזמנה תקפים לזמן מוגבל ולשימוש חד־פעמי. בקשו מבעלי החשבון המשפחתי לשלוח הזמנה חדשה."
        action={
          <ButtonLink to="/login" variant="secondary" size="sm">
            למסך ההתחברות
          </ButtonLink>
        }
      />
    );
  } else if (preview.isPending) {
    body = (
      <Card padding="lg" aria-busy="true">
        <span className="sr-only">טוען את פרטי ההזמנה…</span>
        <Skeleton className="h-7 w-2/3" />
        <Skeleton className="mt-3 h-4 w-full" />
        <Skeleton className="mt-8 h-10 w-full" />
        <Skeleton className="mt-4 h-10 w-full" />
      </Card>
    );
  } else if (preview.isError) {
    body = <ErrorState error={preview.error} onRetry={() => void preview.refetch()} retrying={preview.isFetching} />;
  } else {
    const inv = preview.data;
    body = (
      <Card padding="lg" className="shadow-md">
        <p className="text-sm font-semibold text-sea-700">הזמנה להצטרפות</p>
        <h1 className="mt-1 text-2xl font-bold text-fg">שלום {inv.display_name}</h1>
        <p className="mt-1.5 text-sm leading-relaxed text-fg-muted">
          הוזמנת להצטרף ל־Ori Travel AI של המשפחה. בחרו סיסמה כדי להפעיל את החשבון.
        </p>
        <dl className="mt-5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2.5 rounded-lg bg-surface-sunken p-4 text-sm">
          <dt className="text-fg-muted">אימייל</dt>
          <dd className="truncate font-medium text-fg" dir="ltr">
            <span className="block text-end">{inv.email}</span>
          </dd>
          <dt className="text-fg-muted">תפקיד</dt>
          <dd className="flex flex-wrap items-center gap-2">
            <Badge tone="accent">{ROLE_LABELS[inv.role]}</Badge>
            <span className="text-xs text-fg-subtle">{ROLE_DESCRIPTIONS[inv.role]}</span>
          </dd>
          <dt className="text-fg-muted">בתוקף עד</dt>
          <dd className="text-fg">
            <DateText value={inv.expires_at} preset="datetime" />
          </dd>
        </dl>

        {status === 'authenticated' && user ? (
          <Callout
            tone="warn"
            className="mt-6"
            title={`את/ה מחובר/ת כרגע בתור ${user.display_name}`}
            action={
              <Button variant="secondary" size="sm" onClick={() => void logout()}>
                התנתקות והמשך הצטרפות
              </Button>
            }
          >
            כדי להצטרף עם הזמנה זו יש להתנתק קודם מהחשבון הנוכחי.
          </Callout>
        ) : (
          <AcceptForm token={token} invitation={inv} onJoined={() => setJoined(true)} />
        )}
      </Card>
    );
  }

  const showsOwnHeading = !joined && preview.isSuccess && token.length >= 10;
  return (
    <AuthLayout>
      {!showsOwnHeading && <h1 className="sr-only">הצטרפות ל־Ori Travel AI</h1>}
      {body}
    </AuthLayout>
  );
}
