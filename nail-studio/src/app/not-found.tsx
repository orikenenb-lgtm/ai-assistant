import type { Metadata } from "next";
import { Button } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { NailArt } from "@/components/ui/NailArt";

export const metadata: Metadata = {
  title: "העמוד לא נמצא",
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <section aria-labelledby="not-found-title" className="relative isolate overflow-hidden">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute top-16 start-1/4 h-96 w-96 rounded-full bg-blush/70 blur-3xl" />
      </div>
      <Container size="narrow" className="flex min-h-[70svh] flex-col items-center justify-center gap-7 py-20 text-center">
        <div aria-hidden className="h-40 w-32 overflow-hidden rounded-t-full rounded-b-2xl shadow-lift">
          <NailArt tone="blush" composition="single" />
        </div>
        <p className="font-display text-7xl text-rose-300" dir="ltr">404</p>
        <h1 id="not-found-title" className="font-display text-4xl font-medium text-ink sm:text-5xl">
          העמוד שחיפשת לא נמצא
        </h1>
        <p className="max-w-md text-lg leading-relaxed text-muted">
          ייתכן שהקישור שגוי או שהעמוד הוסר. אפשר לחזור לעמוד הבית ולהמשיך משם.
        </p>
        <Button href="/" size="lg">
          חזרה לעמוד הבית
        </Button>
      </Container>
    </section>
  );
}
