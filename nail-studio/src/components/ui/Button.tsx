import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "dark" | "outline-dark";
type Size = "md" | "lg";

const base =
  "group inline-flex min-h-11 select-none items-center justify-center gap-2 rounded-full font-bold tracking-wide whitespace-nowrap transition-[background-color,color,border-color,box-shadow,transform] duration-300 ease-[var(--ease-premium)] active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50";

const variants: Record<Variant, string> = {
  /** Loud cherry pill — the main call to action */
  primary: "bg-cherry text-night shadow-glow hover:bg-cream hover:shadow-none",
  /** Outline on dark backgrounds */
  secondary: "border border-cream/25 text-cream hover:border-cream hover:bg-cream hover:text-night",
  /** Solid black — for use on cherry/gold backgrounds */
  dark: "bg-night text-cream hover:bg-coal-2",
  /** Outline black — for use on cherry/gold backgrounds */
  "outline-dark": "border-2 border-night text-night hover:bg-night hover:text-cream",
};

const sizes: Record<Size, string> = {
  md: "h-11 px-6 text-sm",
  lg: "h-14 px-8 text-base",
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
