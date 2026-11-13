import { cn } from '@/lib/cn';

const SIZES = { sm: 'size-4', md: 'size-5', lg: 'size-8' } as const;

export interface SpinnerProps {
  size?: keyof typeof SIZES;
  /** Screen-reader label. Ignored when `decorative`. */
  label?: string;
  /** Hide from assistive tech (e.g. inside a button that already sets aria-busy). */
  decorative?: boolean;
  className?: string;
}

export function Spinner({ size = 'md', label = 'טוען…', decorative = false, className }: SpinnerProps) {
  const svg = (
    <svg
      className={cn('animate-spin text-current', SIZES[size], className)}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
  if (decorative) return svg;
  return (
    <span role="status" className="inline-flex items-center">
      {svg}
      <span className="sr-only">{label}</span>
    </span>
  );
}
