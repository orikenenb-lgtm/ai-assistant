import { useEffect, useState } from 'react';
import { cn } from '@/lib/cn';

export function remainingParts(until: string, now: number): { expired: boolean; text: string } {
  const ms = new Date(until).getTime() - now;
  if (!Number.isFinite(ms)) return { expired: false, text: '—' };
  if (ms <= 0) return { expired: true, text: 'פג תוקף' };
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const mmss = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return { expired: false, text: h > 0 ? `${h}:${mmss}` : mmss };
}

/** Live countdown to an expiry timestamp. Purely informational — the server decides validity. */
export function Countdown({ until, className }: { until: string | null | undefined; className?: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  if (!until) return <span className="text-fg-subtle">—</span>;
  const { expired, text } = remainingParts(until, now);
  return (
    <time
      dateTime={until}
      className={cn('tabular-nums', expired ? 'font-semibold text-coral-700' : 'font-semibold text-fg', className)}
      dir="ltr"
      data-testid="countdown"
    >
      {text}
    </time>
  );
}
