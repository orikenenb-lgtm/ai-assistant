import type { ComponentPropsWithoutRef, ElementType } from "react";
import { cn } from "@/lib/utils";

type ContainerProps<T extends ElementType> = {
  as?: T;
  size?: "default" | "narrow";
} & ComponentPropsWithoutRef<T>;

/** Consistent max-width wrapper with responsive side gutters. */
export function Container<T extends ElementType = "div">({
  as,
  size = "default",
  className,
  ...rest
}: ContainerProps<T>) {
  const Component: ElementType = as ?? "div";
  return (
    <Component
      className={cn(
        "mx-auto w-full px-5 sm:px-8 lg:px-10",
        size === "default" ? "max-w-7xl" : "max-w-4xl",
        className,
      )}
      {...rest}
    />
  );
}
