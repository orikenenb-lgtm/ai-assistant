import { Layers } from 'lucide-react';
import { cn } from '@/lib/cn';

/** "מוצעת גם אצל: X, Y" — the same offer found at other providers (deduped to the cheapest). */
export function AlsoOfferedBy({ names, className }: { names: string[]; className?: string }) {
  if (names.length === 0) return null;
  return (
    <p className={cn('flex items-center gap-1.5 text-xs text-fg-muted', className)} data-testid="also-offered-by">
      <Layers className="size-3.5 shrink-0" aria-hidden="true" />
      <span>
        מוצעת גם אצל: <span className="font-medium text-fg">{names.join(', ')}</span>
      </span>
    </p>
  );
}
