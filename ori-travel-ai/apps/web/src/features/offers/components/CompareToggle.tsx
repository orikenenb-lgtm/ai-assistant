import { Scale } from 'lucide-react';
import { Button, useToast } from '@/components/ui';
import { cn } from '@/lib/cn';
import { COMPARE_MAX, useCompareSelection } from '../compareSelection';

export interface CompareToggleProps {
  offerId: string;
  size?: 'sm' | 'md';
  /** Icon-only square button (dense tables); the accessible name stays "השוואה" / "נבחרה להשוואה". */
  compact?: boolean;
  className?: string;
}

/** Adds/removes an offer from the compare selection (persisted per tab, max 10). */
export function CompareToggle({ offerId, size = 'sm', compact = false, className }: CompareToggleProps) {
  const sel = useCompareSelection();
  const { toast } = useToast();
  const selected = sel.has(offerId);
  const onClick = () => {
    const r = sel.toggle(offerId);
    if (r === 'full') {
      toast({ title: `אפשר להשוות עד ${COMPARE_MAX} הצעות`, description: 'הסירו הצעה מההשוואה כדי להוסיף אחרת.', tone: 'warn' });
    }
  };
  if (compact) {
    const label = selected ? 'נבחרה להשוואה' : 'השוואה';
    return (
      <button
        type="button"
        aria-pressed={selected}
        aria-label={label}
        title={label}
        onClick={onClick}
        className={cn(
          'grid size-8 place-items-center rounded-md border transition-colors',
          selected ? 'border-sea-600 bg-sea-600 text-white' : 'border-line text-fg-muted hover:bg-surface-sunken hover:text-fg',
          className,
        )}
      >
        <Scale className="size-4" aria-hidden="true" />
      </button>
    );
  }
  return (
    <Button
      variant={selected ? 'accent' : 'secondary'}
      size={size}
      aria-pressed={selected}
      className={className}
      leadingIcon={<Scale aria-hidden="true" />}
      onClick={onClick}
    >
      {selected ? 'נבחרה להשוואה' : 'השוואה'}
    </Button>
  );
}
