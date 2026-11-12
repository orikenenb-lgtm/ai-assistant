import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import type { ReactElement, ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface TooltipProps {
  content: ReactNode;
  /** A single focusable element that accepts a ref (button, link, tabbable span). */
  children: ReactElement;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
  delayDuration?: number;
  className?: string;
}

/**
 * Accessible tooltip (hover + keyboard focus, Escape to close).
 * Self-contained provider so it works anywhere (incl. tests). Tooltips are
 * supplementary — never put essential information only in a tooltip.
 */
export function Tooltip({ content, children, side = 'top', align = 'center', delayDuration = 250, className }: TooltipProps) {
  return (
    <TooltipPrimitive.Provider delayDuration={delayDuration} skipDelayDuration={200}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            side={side}
            align={align}
            sideOffset={6}
            collisionPadding={12}
            className={cn(
              'z-[70] max-w-72 rounded-md bg-ink-900 px-3 py-2 text-xs leading-relaxed text-white shadow-md animate-fade-in',
              className,
            )}
          >
            {content}
            <TooltipPrimitive.Arrow className="fill-ink-900" width={10} height={5} />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
