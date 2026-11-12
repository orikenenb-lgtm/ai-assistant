import * as SwitchPrimitive from '@radix-ui/react-switch';
import { useId, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface SwitchProps {
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  id?: string;
  name?: string;
  className?: string;
}

/** On/off toggle (role="switch"). RTL-aware thumb movement. */
export function Switch({ label, description, id, className, disabled, ...rest }: SwitchProps) {
  const generated = useId();
  const switchId = id ?? `sw-${generated}`;
  const descId = description ? `${switchId}-desc` : undefined;
  return (
    <div className={cn('flex items-start justify-between gap-4', className)}>
      <div className="flex flex-col">
        <label htmlFor={switchId} className={cn('text-sm font-medium text-fg', disabled ? 'cursor-not-allowed' : 'cursor-pointer')}>
          {label}
        </label>
        {description && (
          <p id={descId} className="text-xs leading-relaxed text-fg-subtle">
            {description}
          </p>
        )}
      </div>
      <SwitchPrimitive.Root
        id={switchId}
        disabled={disabled}
        aria-describedby={descId}
        className={cn(
          'relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent',
          'bg-ink-300 transition-colors duration-150 data-[state=checked]:bg-sea-600',
          'disabled:cursor-not-allowed disabled:opacity-55',
        )}
        {...rest}
      >
        <SwitchPrimitive.Thumb
          className={cn(
            'pointer-events-none block size-5 rounded-full bg-white shadow-sm transition-transform duration-150',
            'data-[state=checked]:translate-x-5 rtl:data-[state=checked]:-translate-x-5',
          )}
        />
      </SwitchPrimitive.Root>
    </div>
  );
}
