import { cn } from '@/lib/cn';

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={cn('size-9 shrink-0', className)} aria-hidden="true">
      <rect width="64" height="64" rx="16" fill="#142339" />
      <circle cx="32" cy="34" r="12" fill="#e9b872" />
      <rect x="10" y="34" width="44" height="20" fill="#142339" />
      <path
        d="M12 38c4 0 4-2.5 8-2.5s4 2.5 8 2.5 4-2.5 8-2.5 4 2.5 8 2.5 4-2.5 8-2.5"
        fill="none"
        stroke="#6fc5b8"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path
        d="M16 45c4 0 4-2 8-2s4 2 8 2 4-2 8-2 4 2 8 2"
        fill="none"
        stroke="#6fc5b8"
        strokeOpacity=".55"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Brand lockup. `tone="light"` for dark surfaces. */
export function Logo({ tone = 'dark', compact = false, className }: { tone?: 'dark' | 'light'; compact?: boolean; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <LogoMark className={tone === 'light' ? 'ring-1 ring-white/15 rounded-[0.6rem]' : undefined} />
      <span className="flex flex-col leading-none" dir="ltr">
        <span className={cn('text-lg font-bold tracking-tight', tone === 'light' ? 'text-white' : 'text-ink-900')}>Ori</span>
        {!compact && (
          <span className={cn('mt-0.5 text-[0.7rem] font-medium tracking-wide', tone === 'light' ? 'text-sun-300' : 'text-sea-700')}>
            Travel AI
          </span>
        )}
      </span>
    </span>
  );
}
