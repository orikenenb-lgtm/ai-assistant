import { useId, type ComponentProps, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface CheckboxProps extends Omit<ComponentProps<'input'>, 'type'> {
  label: ReactNode;
  description?: ReactNode;
  error?: ReactNode;
}

/** Native checkbox with label/description (keyboard + screen-reader friendly). */
export function Checkbox({ label, description, error, id, className, ...rest }: CheckboxProps) {
  const generated = useId();
  const inputId = id ?? `cb-${generated}`;
  const descId = description ? `${inputId}-desc` : undefined;
  const errId = error ? `${inputId}-err` : undefined;
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <div className="flex items-start gap-2.5">
        <input
          id={inputId}
          type="checkbox"
          aria-describedby={[errId, descId].filter(Boolean).join(' ') || undefined}
          aria-invalid={error ? true : undefined}
          className="mt-0.5 size-[1.125rem] shrink-0 cursor-pointer rounded accent-sea-600 disabled:cursor-not-allowed"
          {...rest}
        />
        <div className="flex flex-col">
          <label htmlFor={inputId} className="cursor-pointer text-sm font-medium text-fg">
            {label}
          </label>
          {description && (
            <p id={descId} className="text-xs leading-relaxed text-fg-subtle">
              {description}
            </p>
          )}
        </div>
      </div>
      {error && (
        <p id={errId} className="ps-7 text-sm text-coral-700">
          {error}
        </p>
      )}
    </div>
  );
}
