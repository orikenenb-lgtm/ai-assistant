import { Eye, EyeOff, ShieldAlert } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button, Callout } from '@/components/ui';
import { reauth, revealPassport } from '@/features/travelers/api';
import { isApiError } from '@/lib/api';
import { ReauthDialog } from './ReauthDialog';

export const REVEAL_SECONDS = 30;

/** Reveals the passport number on demand: reauth if needed, auto-hides after 30 seconds, never cached. Render with `key={memberId}`. */
export function PassportReveal({ memberId, masked }: { memberId: string; masked: string | null | undefined }) {
  const [number, setNumber] = useState<string | null>(null);
  const [left, setLeft] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<{ message: string; encryption: boolean } | null>(null);
  const [needReauth, setNeedReauth] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  function stop() {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  }
  function hide() {
    stop();
    setNumber(null);
    setLeft(0);
  }
  useEffect(() => stop, []);

  function show(value: string) {
    stop();
    setNumber(value);
    setLeft(REVEAL_SECONDS);
    timer.current = setInterval(() => {
      setLeft((l) => {
        if (l <= 1) {
          stop();
          setNumber(null);
          return 0;
        }
        return l - 1;
      });
    }, 1000);
  }

  async function reveal() {
    setPending(true);
    setError(null);
    try {
      const r = await revealPassport(memberId);
      show(r.passport_number);
    } catch (e) {
      if (isApiError(e) && e.status === 403 && e.code === 'REAUTH_REQUIRED') setNeedReauth(true);
      else if (isApiError(e) && e.status === 503 && e.code === 'ENCRYPTION_UNAVAILABLE')
        setError({
          message: 'לא ניתן לפענח את הנתונים: מפתח ההצפנה של השרת אינו מוגדר. בעל החשבון צריך להגדיר את ORI_DATA_KEY בהגדרות השרת ולהפעיל אותו מחדש.',
          encryption: true,
        });
      else setError({ message: isApiError(e) ? e.message : 'לא ניתן להציג את מספר הדרכון', encryption: false });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-2" data-testid="passport-reveal">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-mono text-sm tracking-wider text-fg" dir="ltr" data-testid="passport-value" aria-live="polite">
          {number ?? masked ?? '••••••'}
        </span>
        {number ? (
          <>
            <span className="text-xs text-fg-muted">יוסתר בעוד {left} שניות</span>
            <Button size="sm" variant="secondary" leadingIcon={<EyeOff aria-hidden="true" />} onClick={hide}>
              הסתרה
            </Button>
          </>
        ) : (
          <Button size="sm" variant="secondary" leadingIcon={<Eye aria-hidden="true" />} loading={pending} onClick={() => void reveal()}>
            הצג מספר דרכון
          </Button>
        )}
      </div>
      {error && (
        <Callout tone={error.encryption ? 'warn' : 'danger'} icon={<ShieldAlert />} role="alert">
          {error.message}
        </Callout>
      )}
      <ReauthDialog
        open={needReauth}
        onOpenChange={setNeedReauth}
        onConfirm={async (password) => {
          await reauth(password);
          setNeedReauth(false);
          await reveal();
        }}
      />
    </div>
  );
}
