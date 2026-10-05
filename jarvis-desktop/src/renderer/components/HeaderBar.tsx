/**
 * שורת המצב העליונה: שעון חי ותאריך עברי (Asia/Jerusalem), וצ'יפים של מיקרופון / מילת הפעלה / חיבור AI.
 */
import { useNowMs } from '../hooks/environment';
import { he } from '../i18n/he';
import { aiChip, micChip, wakeChip, type ChipView } from '../state/chips';
import { useUiState } from '../state/controller';
import { formatClock, formatHebrewCalendarDate, formatHebrewDate } from '../state/format';

export function Chip({ chip, compact = false }: { chip: ChipView; compact?: boolean }) {
  return (
    <span className="chip" data-tone={chip.tone} data-pulse={chip.pulse ? 'on' : undefined} data-compact={compact ? 'on' : undefined} title={chip.title}>
      <span className="chip-dot" aria-hidden="true" />
      <span className="chip-text">{chip.text}</span>
    </span>
  );
}

export function LiveClock() {
  const now = new Date(useNowMs());
  return (
    <div className="clock-block">
      <time className="clock hud-num" dir="ltr" dateTime={now.toISOString()} aria-label={he.header.clockLabel}>
        {formatClock(now)}
      </time>
      <div className="date-he">{formatHebrewDate(now)}</div>
      <div className="date-hebcal">{formatHebrewCalendarDate(now)}</div>
    </div>
  );
}

export function StatusChips() {
  const audioPhase = useUiState((s) => s.audioPhase);
  const micStarting = useUiState((s) => s.micStarting);
  const micTest = useUiState((s) => s.micTest);
  const wake = useUiState((s) => s.wake);
  const settings = useUiState((s) => s.settings);
  const services = useUiState((s) => s.services);

  const mic = micChip({ audioPhase, micStarting, micTest });
  const wakeView = wakeChip(wake);
  const ai = aiChip(settings, services);

  return (
    <div className="chips" role="status" aria-label={he.header.statusRegion}>
      <Chip chip={mic} />
      {wakeView && <Chip chip={wakeView} />}
      <Chip chip={ai} />
    </div>
  );
}

export function HeaderBar() {
  return (
    <div className="hud-header">
      <LiveClock />
      <StatusChips />
    </div>
  );
}
