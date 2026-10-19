"use client";

import { ThemeProvider } from "next-themes";
import { Direction } from "radix-ui";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/menu";

export function AppProviders({ children, dir, nonce }: { children: React.ReactNode; dir: "rtl" | "ltr"; nonce?: string }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange nonce={nonce}>
      <Direction.DirectionProvider dir={dir}>
        <TooltipProvider delayDuration={300}>
          {children}
          <Toaster
            dir={dir}
            position={dir === "rtl" ? "bottom-left" : "bottom-right"}
            richColors
            closeButton
            toastOptions={{ className: "font-sans" }}
          />
        </TooltipProvider>
      </Direction.DirectionProvider>
    </ThemeProvider>
  );
}
