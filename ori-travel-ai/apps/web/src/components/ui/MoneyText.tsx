import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { formatMoney } from '@/lib/format';
import type { Money } from '@/lib/schemas/common';

export interface MoneyTextProps {
  /** `{amount: "123.45", currency: "ILS"}` — amount is a decimal STRING. */
  value?: Money | null;
  /** Alternative to `value`. */
  amount?: string | null;
  currency?: string | null;
  /** Price is an estimate → prefixed "כ־" with an explanation. */
  estimated?: boolean;
  compact?: boolean;
  fallback?: ReactNode;
  className?: string;
}

/**
 * Display-only money formatting (he-IL). Never parse amounts to float for math:
 * arithmetic happens on the server with Decimal.
 */
export function MoneyText({ value, amount, currency, estimated = false, compact = false, fallback = '—', className }: MoneyTextProps) {
  const a = value?.amount ?? amount ?? null;
  const c = value?.currency ?? currency ?? null;
  const formatted = a !== null && c ? formatMoney(a, c, { compact }) : null;

  if (!formatted) {
    return (
      <span className={cn('text-fg-subtle', className)} aria-label="סכום לא זמין">
        {fallback}
      </span>
    );
  }
  return (
    <span
      className={cn('whitespace-nowrap tabular-nums', className)}
      data-currency={c}
      data-amount={a}
      title={estimated ? 'מחיר משוער — הסכום הסופי ייקבע אצל הספק' : undefined}
    >
      {estimated && <span>כ־</span>}
      {formatted}
    </span>
  );
}
