"use client";

import * as React from "react";
import { Checkbox as C, Switch as S, Tabs as T } from "radix-ui";
import { Check, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

export function Checkbox({ className, ...props }: React.ComponentProps<typeof C.Root>) {
  return (
    <C.Root
      className={cn(
        "peer flex size-4 shrink-0 items-center justify-center rounded border border-input bg-surface shadow-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary data-[state=indeterminate]:text-primary-foreground disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <C.Indicator>{props.checked === "indeterminate" ? <Minus className="size-3" /> : <Check className="size-3" />}</C.Indicator>
    </C.Root>
  );
}

export function Switch({ className, ...props }: React.ComponentProps<typeof S.Root>) {
  return (
    <S.Root
      className={cn(
        "inline-flex h-5 w-9 shrink-0 items-center rounded-full border-2 border-transparent bg-input outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring data-[state=checked]:bg-primary disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <S.Thumb className="block size-4 rounded-full bg-white shadow-sm transition-transform data-[state=checked]:translate-x-4 rtl:data-[state=checked]:-translate-x-4" />
    </S.Root>
  );
}

export const Tabs = T.Root;
export function TabsList({ className, ...props }: React.ComponentProps<typeof T.List>) {
  return <T.List className={cn("inline-flex h-9 items-center gap-1 rounded-lg bg-muted p-1", className)} {...props} />;
}
export function TabsTrigger({ className, ...props }: React.ComponentProps<typeof T.Trigger>) {
  return (
    <T.Trigger
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-md px-3 text-sm font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-[state=active]:bg-surface data-[state=active]:text-foreground data-[state=active]:shadow-xs [&_svg]:size-4",
        className,
      )}
      {...props}
    />
  );
}
export function TabsContent({ className, ...props }: React.ComponentProps<typeof T.Content>) {
  return <T.Content className={cn("mt-4 outline-none", className)} {...props} />;
}
