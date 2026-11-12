import { Scale } from 'lucide-react';
import { Button, useToast } from '@/components/ui';
import { COMPARE_MAX, useCompareSelection } from '../compareSelection';

export interface CompareToggleProps {
  offerId: string;
  size?: 'sm' | 'md';
  className?: string;
}

/** Adds/removes an offer from the compare selection (persisted per tab, max 10). */
export function CompareToggle({ offerId, size = 'sm', className }: CompareToggleProps) {
  const sel = useCompareSelection();
  const { toast } = useToast();
  const selected = sel.has(offerId);
  return (
    <Button
      variant={selected ? 'accent' : 'secondary'}
      size={size}
      aria-pressed={selected}
      className={className}
      leadingIcon={<Scale aria-hidden="true" />}
      onClick={() => {
        const r = sel.toggle(offerId);
        if (r === 'full') {
          toast({ title: `אפשר להשוות עד ${COMPARE_MAX} הצעות`, description: 'הסירו הצעה מההשוואה כדי להוסיף אחרת.', tone: 'warn' });
        }
      }}
    >
      {selected ? 'נבחרה להשוואה' : 'השוואה'}
    </Button>
  );
}
