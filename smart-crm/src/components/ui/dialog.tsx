"use client";

import * as React from "react";
import { Dialog as D } from "radix-ui";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

export function DialogContent({
  className,
  children,
  size = "md",
  closeLabel = "Close",
  ...props
}: React.ComponentProps<typeof D.Content> & { size?: "sm" | "md" | "lg" | "xl"; closeLabel?: string }) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] data-[state=open]:animate-fade-in" />
      <D.Content
        className={cn(
          "fixed inset-x-3 top-[8vh] z-50 mx-auto max-h-[84vh] overflow-y-auto rounded-2xl border border-border bg-surface-raised p-6 shadow-lg outline-none data-[state=open]:animate-scale-in sm:inset-x-6",
          { sm: "max-w-sm", md: "max-w-lg", lg: "max-w-2xl", xl: "max-w-4xl" }[size],
          className,
        )}
        {...props}
      >
        {children}
        <D.Close
          className="absolute end-4 top-4 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-label={closeLabel}
        >
          <X className="size-4" />
        </D.Close>
      </D.Content>
    </D.Portal>
  );
}

export function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("mb-5 flex flex-col gap-1.5 pe-8", className)} {...props} />;
}

export function DialogTitle({ className, ...props }: React.ComponentProps<typeof D.Title>) {
  return <D.Title className={cn("text-lg font-semibold leading-tight", className)} {...props} />;
}

export function DialogDescription({ className, ...props }: React.ComponentProps<typeof D.Description>) {
  return <D.Description className={cn("text-sm text-muted-foreground", className)} {...props} />;
}

export function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)} {...props} />;
}

/** Side panel (drawer) — slides from the inline end. */
export function SheetContent({
  className,
  children,
  closeLabel = "Close",
  ...props
}: React.ComponentProps<typeof D.Content> & { closeLabel?: string }) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-50 bg-black/30 data-[state=open]:animate-fade-in" />
      <D.Content
        className={cn(
          "fixed inset-y-0 end-0 z-50 flex w-full max-w-md flex-col overflow-y-auto border-s border-border bg-surface-raised p-6 shadow-lg outline-none data-[state=open]:animate-slide-in-end",
          className,
        )}
        {...props}
      >
        {children}
        <D.Close
          className="absolute end-4 top-4 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label={closeLabel}
        >
          <X className="size-4" />
        </D.Close>
      </D.Content>
    </D.Portal>
  );
}
