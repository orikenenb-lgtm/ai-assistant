import { FlaskConical, TriangleAlert } from 'lucide-react';
import { Badge } from '@/components/ui';
import { STATE_TONES, UNVERIFIED_REFERENCE_LABEL, isBookingState } from '../labels';

export function BookingStateBadge({ state, label, unverified }: { state: string; label?: string; unverified?: boolean }) {
  // An unverified, hand-typed supplier reference gets a warning badge — never the green "confirmed" one (RA-02).
  const warn = state === 'CONFIRMED' && (unverified === true || label === UNVERIFIED_REFERENCE_LABEL);
  const tone = warn ? 'warn' : isBookingState(state) ? STATE_TONES[state] : 'neutral';
  return (
    <Badge tone={tone} data-testid="state-badge" data-state={state} data-unverified={warn ? 'true' : undefined}>
      {warn && <TriangleAlert aria-hidden="true" />}
      {warn ? UNVERIFIED_REFERENCE_LABEL : (label ?? state)}
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

/** DEMO supplier with hosted checkout: fictional supplier, nothing real is booked or charged. */
export function DemoSupplierBadge() {
  return (
    <Badge tone="demo" size="sm" data-testid="demo-supplier-badge">
      <FlaskConical aria-hidden="true" /> ספק לדוגמה (DEMO)
    </Badge>
  );
}
