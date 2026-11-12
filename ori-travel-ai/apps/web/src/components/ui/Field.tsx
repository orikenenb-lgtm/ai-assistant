import { CircleAlert } from 'lucide-react';
import { createContext, useContext, useId, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface FieldContextValue {
  id: string;
  describedBy: string | undefined;
  invalid: boolean;
  required: boolean;
  disabled: boolean;
}

const FieldContext = createContext<FieldContextValue | null>(null);

interface ControlA11yProps {
  id?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean | 'true' | 'false' | 'grammar' | 'spelling';
  required?: boolean;
  disabled?: boolean;
}

/**
 * Merges a control's own props with the surrounding <Field>'s id,
 * aria-describedby (error + hint), aria-invalid, required and disabled.
 */
export function useFieldControl<P extends ControlA11yProps>(props: P): P {
  const ctx = useContext(FieldContext);
  if (!ctx) return props;
  const describedBy = [props['aria-describedby'], ctx.describedBy].filter(Boolean).join(' ') || undefined;
  return {
    ...props,
    id: props.id ?? ctx.id,
    'aria-describedby': describedBy,
    'aria-invalid': props['aria-invalid'] ?? (ctx.invalid || undefined),
    required: props.required ?? (ctx.required || undefined),
    disabled: props.disabled ?? (ctx.disabled || undefined),
  };
}

export interface FieldProps {
  label: ReactNode;
  children: ReactNode;
  hint?: ReactNode;
  /** Hebrew error message; marks the control aria-invalid and links it via aria-describedby. */
  error?: ReactNode;
  required?: boolean;
  /** Shows "(רשות)" next to the label. */
  optional?: boolean;
  disabled?: boolean;
  /** Explicit control id (otherwise generated). */
  id?: string;
  className?: string;
  labelClassName?: string;
}

export function Field({
  label,
  children,
  hint,
  error,
  required = false,
  optional = false,
  disabled = false,
  id,
  className,
  labelClassName,
}: FieldProps) {
  const generated = useId();
  const controlId = id ?? `field-${generated}`;
  const hintId = hint ? `${controlId}-hint` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined;

  return (
    <FieldContext.Provider value={{ id: controlId, describedBy, invalid: !!error, required, disabled }}>
      <div className={cn('flex flex-col gap-1.5', className)}>
        <label htmlFor={controlId} className={cn('text-sm font-medium text-fg', labelClassName)}>
          {label}
          {required && (
            <span aria-hidden="true" className="ms-0.5 text-coral-600">
              *
            </span>
          )}
          {optional && <span className="ms-1 text-xs font-normal text-fg-subtle">(רשות)</span>}
        </label>
        {children}
        {error && (
          <div id={errorId} className="flex items-start gap-1.5 text-sm text-coral-700">
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}
        {hint && (
          // div (not p) so hints may contain lists / block content
          <div id={hintId} className="text-xs leading-relaxed text-fg-subtle">
            {hint}
          </div>
        )}
      </div>
    </FieldContext.Provider>
  );
}
