import { Eye, EyeOff, LogIn } from 'lucide-react';
import { useId, useRef, useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { z } from 'zod';
import { AuthLayout } from '@/components/layout/AuthLayout';
import { Button, Callout, Card, Field, Input } from '@/components/ui';
import { useAuth } from '@/features/auth';
import { isApiError } from '@/lib/api';
import { useDocumentTitle } from '@/lib/useDocumentTitle';

const LoginSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, 'יש להזין כתובת אימייל')
    .max(254, 'כתובת האימייל ארוכה מדי')
    .regex(/^[^\s@<>"']+@[^\s@]+\.[^\s@]{2,}$/, 'כתובת האימייל אינה תקינה'),
  password: z.string().min(1, 'יש להזין סיסמה').max(256, 'הסיסמה ארוכה מדי'),
});

type FieldErrors = Partial<Record<'email' | 'password', string>>;

/** Only same-app paths are allowed as post-login redirects (no open redirects). */
export function safeRedirect(from: unknown): string {
  if (typeof from !== 'string' || !from.startsWith('/') || from.startsWith('//') || from.startsWith('/login')) return '/';
  return from;
}

export default function LoginPage() {
  useDocumentTitle('התחברות');
  const { status, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const redirectTo = safeRedirect((location.state as { from?: unknown } | null)?.from);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<{ tone: 'danger' | 'warn'; title: string; message: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const headingId = useId();

  if (status === 'authenticated') return <Navigate to={redirectTo} replace />;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);
    const parsed = LoginSchema.safeParse({ email, password });
    if (!parsed.success) {
      const errs: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof FieldErrors;
        errs[key] ??= issue.message;
      }
      setFieldErrors(errs);
      (errs.email ? emailRef : passwordRef).current?.focus();
      return;
    }
    setFieldErrors({});
    setSubmitting(true);
    try {
      await login(parsed.data.email, parsed.data.password);
      navigate(redirectTo, { replace: true });
    } catch (err) {
      if (isApiError(err) && err.code === 'RATE_LIMITED') {
        setFormError({ tone: 'warn', title: 'הכניסה נחסמה זמנית', message: err.message });
      } else if (isApiError(err) && err.code === 'INVALID_CREDENTIALS') {
        setFormError({ tone: 'danger', title: 'לא הצלחנו להכניס אותך', message: err.message });
        setPassword('');
        passwordRef.current?.focus();
      } else if (isApiError(err) && err.code === 'VALIDATION_ERROR') {
        const fe = err.fieldErrors();
        setFieldErrors({
          email: fe.email ? 'כתובת האימייל אינה תקינה' : undefined,
          password: fe.password ? 'הסיסמה אינה תקינה' : undefined,
        });
      } else {
        setFormError({
          tone: 'danger',
          title: 'ההתחברות נכשלה',
          message: isApiError(err) ? err.message : 'אירעה שגיאה בלתי צפויה. נסו שוב.',
        });
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout>
      <Card padding="lg" className="shadow-md">
        <h1 id={headingId} className="text-2xl font-bold text-fg">
          התחברות
        </h1>
        <p className="mt-1.5 text-sm text-fg-muted">ברוכים השבים! הכניסה מיועדת לבני המשפחה בלבד.</p>

        <form className="mt-6 flex flex-col gap-4" noValidate onSubmit={onSubmit} aria-labelledby={headingId}>
          {formError && (
            <Callout tone={formError.tone} title={formError.title} role="alert">
              {formError.message}
            </Callout>
          )}
          <Field label="אימייל" error={fieldErrors.email} required>
            <Input
              ref={emailRef}
              type="email"
              name="email"
              dir="ltr"
              inputMode="email"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="name@family.local"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="text-start"
            />
          </Field>
          <Field label="סיסמה" error={fieldErrors.password} required>
            <div className="relative">
              <Input
                ref={passwordRef}
                type={showPassword ? 'text' : 'password'}
                name="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="pe-11"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute inset-y-0 end-0 grid w-11 place-items-center rounded-e-md text-fg-subtle hover:text-fg"
                aria-label={showPassword ? 'הסתרת הסיסמה' : 'הצגת הסיסמה'}
                aria-pressed={showPassword}
              >
                {showPassword ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
              </button>
            </div>
          </Field>
          <Button
            type="submit"
            size="lg"
            fullWidth
            loading={submitting}
            loadingText="מתחבר…"
            leadingIcon={<LogIn className="rtl:rotate-180" aria-hidden="true" />}
            className="mt-2"
          >
            כניסה
          </Button>
        </form>

        <p className="mt-6 border-t border-line pt-4 text-sm leading-relaxed text-fg-muted">
          אין לכם חשבון? ההצטרפות אפשרית רק בהזמנה מבעלי החשבון המשפחתי.
        </p>
      </Card>
    </AuthLayout>
  );
}
