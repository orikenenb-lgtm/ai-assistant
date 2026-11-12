import { FlaskConical } from 'lucide-react';
import { Badge } from '@/components/ui';
import { STATE_TONES, isBookingState } from '../labels';

export function BookingStateBadge({ state, label }: { state: string; label?: string }) {
  const tone = isBookingState(state) ? STATE_TONES[state] : 'neutral';
  return (
    <Badge tone={tone} data-testid="state-badge" data-state={state}>
      {label ?? state}
    </Badge>
  );
}

export function SimulationBadge() {
  return (
    <Badge tone="demo" size="sm" data-testid="simulation-badge">
      <FlaskConical aria-hidden="true" /> סימולציה
    </Badge>
  );
}
