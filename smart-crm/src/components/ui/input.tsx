import * as React from "react";
import { cn } from "@/lib/utils";

const fieldBase =
  "w-full rounded-lg border border-input bg-surface px-3 text-sm text-foreground shadow-xs transition-[border-color,box-shadow] duration-150 placeholder:text-muted-foreground/80 outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:border-danger aria-invalid:ring-danger/15";

export function Input({ className, type = "text", ...props }: React.ComponentProps<"input">) {
  return <input type={type} className={cn(fieldBase, "h-9", className)} {...props} />;
}

export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return <textarea className={cn(fieldBase, "min-h-24 py-2 leading-relaxed", className)} {...props} />;
}

/** Native select: accessible, fast and correct on mobile. */
export function NativeSelect({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <select className={cn(fieldBase, "h-9 appearance-none bg-[length:16px] bg-no-repeat pe-8", "select-chevron", className)} {...props}>
      {children}
    </select>
  );
}

export function Label({ className, ...props }: React.ComponentProps<"label">) {
  return <label className={cn("text-sm font-medium text-foreground", className)} {...props} />;
}

type FieldProps = {
  label?: React.ReactNode;
  htmlFor?: string;
  error?: string | string[] | null;
  hint?: React.ReactNode;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
};

/** Label + control + hint/error, wired for screen readers via ids. */
export function Field({ label, htmlFor, error, hint, required, className, children }: FieldProps) {
  const message = Array.isArray(error) ? error[0] : error;
  const errorId = htmlFor ? `${htmlFor}-error` : undefined;
  const hintId = htmlFor ? `${htmlFor}-hint` : undefined;
  const control = React.isValidElement(children)
    ? React.cloneElement(children as React.ReactElement<Record<string, unknown>>, {
        "aria-invalid": message ? true : undefined,
        "aria-describedby": [message ? errorId : null, hint ? hintId : null].filter(Boolean).join(" ") || undefined,
      })
    : children;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {label && (
        <Label htmlFor={htmlFor}>
          {label}
          {required && <span className="ms-0.5 text-danger" aria-hidden>*</span>}
        </Label>
      )}
      {control}
      {hint && !message && (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {message && (
        <p id={errorId} role="alert" className="text-xs font-medium text-danger-foreground">
          {message}
        </p>
      )}
    </div>
  );
}
