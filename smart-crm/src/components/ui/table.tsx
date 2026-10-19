import * as React from "react";
import { cn } from "@/lib/utils";

/** Responsive table: horizontally scrollable on small screens, sticky header. */
export function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div className="relative w-full overflow-x-auto rounded-xl border border-border bg-surface">
      <table className={cn("w-full caption-bottom border-collapse text-sm", className)} {...props} />
    </div>
  );
}
export function THead({ className, ...props }: React.ComponentProps<"thead">) {
  return <thead className={cn("bg-muted/60 [&_tr]:border-b", className)} {...props} />;
}
export function TBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return <tbody className={cn("[&_tr:last-child]:border-0", className)} {...props} />;
}
export function TR({ className, ...props }: React.ComponentProps<"tr">) {
  return <tr className={cn("border-b border-border transition-colors hover:bg-accent/50", className)} {...props} />;
}
export function TH({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      scope="col"
      className={cn("h-10 whitespace-nowrap px-4 text-start align-middle text-xs font-medium uppercase tracking-wide text-muted-foreground", className)}
      {...props}
    />
  );
}
export function TD({ className, ...props }: React.ComponentProps<"td">) {
  return <td className={cn("px-4 py-3 align-middle", className)} {...props} />;
}
