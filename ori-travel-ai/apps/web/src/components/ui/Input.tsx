import { ChevronDown } from 'lucide-react';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';
import { useFieldControl } from './Field';

/** Shared look for text inputs / selects / textareas (16px text on touch: no iOS zoom-on-focus). */
const controlLook = cn(
  'w-full rounded-md border border-control bg-surface text-sm text-fg shadow-xs pointer-coarse:text-base',
  'placeholder:text-fg-subtle transition-colors duration-150 hover:border-ink-500',
  'focus-visible:border-accent focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-focus',
  'aria-[invalid=true]:border-coral-600 aria-[invalid=true]:focus-visible:outline-coral-600',
  'disabled:cursor-not-allowed disabled:border-ink-200 disabled:bg-surface-sunken disabled:text-fg-subtle',
);

/** Single-line controls (inputs, selects, combobox buttons): at least 44px tall on touch screens. */
export const controlClasses = cn(controlLook, 'pointer-coarse:min-h-touch');

export type InputProps = ComponentProps<'input'>;

/** Text-like input. Place inside <Field> for label/hint/error wiring. */
export function Input({ className, ...props }: InputProps) {
  const merged = useFieldControl(props);
  return <input className={cn(controlClasses, 'h-10 px-3', className)} {...merged} />;
}

export type TextareaProps = ComponentProps<'textarea'>;

export function Textarea({ className, rows = 4, ...props }: TextareaProps) {
  const merged = useFieldControl(props);
  return <textarea rows={rows} className={cn(controlLook, 'min-h-20 px-3 py-2 leading-relaxed', className)} {...merged} />;
}

export interface NativeSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface NativeSelectProps extends ComponentProps<'select'> {
  options?: NativeSelectOption[];
  placeholder?: string;
}

/** Native <select> (best mobile + a11y behavior) with consistent styling. */
export function NativeSelect({ className, options, placeholder, children, ...props }: NativeSelectProps) {
  const merged = useFieldControl(props);
  return (
    <div className="relative">
      <select className={cn(controlClasses, 'h-10 appearance-none ps-3 pe-9', className)} {...merged}>
        {placeholder !== undefined && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {options?.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
        {children}
      </select>
      <ChevronDown
        className="pointer-events-none absolute end-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle"
        aria-hidden="true"
      />
    </div>
  );
}
