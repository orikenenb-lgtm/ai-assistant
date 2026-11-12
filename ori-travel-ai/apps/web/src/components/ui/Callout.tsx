import { CircleAlert, CircleCheck, Info, TriangleAlert, type LucideIcon } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/cn';

export type CalloutTone = 'info' | 'success' | 'warn' | 'danger' | 'neutral';

const TONES: Record<CalloutTone, { box: string; icon: string; Icon: LucideIcon }> = {
  info: { box: 'border-harbor-200 bg-harbor-50 text-harbor-700', icon: 'text-harbor-600', Icon: Info },
  success: { box: 'border-moss-200 bg-moss-50 text-moss-700', icon: 'text-moss-600', Icon: CircleCheck },
  warn: { box: 'border-amber-200 bg-amber-50 text-amber-700', icon: 'text-amber-600', Icon: TriangleAlert },
  danger: { box: 'border-coral-200 bg-coral-50 text-coral-700', icon: 'text-coral-600', Icon: CircleAlert },
  neutral: { box: 'border-line bg-surface-sunken text-fg-muted', icon: 'text-fg-subtle', Icon: Info },
};

export interface CalloutProps extends Omit<ComponentProps<'div'>, 'title'> {
  tone?: CalloutTone;
  title?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
}

export function Callout({ tone = 'info', title, icon, action, className, children, ...rest }: CalloutProps) {
  const t = TONES[tone];
  return (
    <div className={cn('flex gap-3 rounded-lg border p-4 text-sm leading-relaxed', t.box, className)} {...rest}>
      <span className={cn('mt-0.5 shrink-0 [&_svg]:size-5', t.icon)} aria-hidden="true">
        {icon ?? <t.Icon />}
      </span>
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={cn(title && 'mt-1')}>{children}</div>}
        {action && <div className="mt-3">{action}</div>}
      </div>
    </div>
  );
}
