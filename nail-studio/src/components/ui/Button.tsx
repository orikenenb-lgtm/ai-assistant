import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "light" | "outline-light";
type Size = "md" | "lg";

const base =
  "group inline-flex min-h-11 select-none items-center justify-center gap-2 rounded-full font-medium tracking-wide whitespace-nowrap transition-[background-color,color,border-color,box-shadow,transform] duration-300 ease-[var(--ease-premium)] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50";

const variants: Record<Variant, string> = {
  primary: "bg-ink text-ivory shadow-soft hover:bg-ink-soft hover:shadow-lift",
  secondary: "border border-ink/15 bg-transparent text-ink hover:border-ink/35 hover:bg-cream",
  light: "bg-ivory text-ink shadow-soft hover:bg-cream",
  "outline-light": "border border-ivory/30 text-ivory hover:border-ivory/60 hover:bg-ivory/10",
};

const sizes: Record<Size, string> = {
  md: "h-11 px-6 text-sm",
  lg: "h-13 px-8 text-base",
};

interface CommonProps {
  variant?: Variant;
  size?: Size;
  className?: string;
  children: ReactNode;
}

type LinkButtonProps = CommonProps &
  Omit<ComponentPropsWithoutRef<"a">, keyof CommonProps> & {
    href: string;
    /** Opens in a new tab with safe `rel` attributes. */
    external?: boolean;
  };

type NativeButtonProps = CommonProps &
  Omit<ComponentPropsWithoutRef<"button">, keyof CommonProps> & { href?: undefined };

export type ButtonProps = LinkButtonProps | NativeButtonProps;

export function buttonClasses(variant: Variant = "primary", size: Size = "md", className?: string) {
  return cn(base, variants[variant], sizes[size], className);
}

/** Renders an `<a>` when given `href`, otherwise a `<button>`. */
export function Button(props: ButtonProps) {
  if (props.href !== undefined) {
    const { variant, size, className, children, external, ...rest } = props;
    return (
      <a
        {...rest}
        className={buttonClasses(variant, size, className)}
        {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      >
        {children}
      </a>
    );
  }
  const { variant, size, className, children, type = "button", ...rest } = props;
  return (
    <button {...rest} type={type} className={buttonClasses(variant, size, className)}>
      {children}
    </button>
  );
}
