import type { Metadata } from "next";
import { Button } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";

export const metadata: Metadata = {
  title: "העמוד לא נמצא",
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <section aria-labelledby="not-found-title" className="relative isolate overflow-hidden">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute top-[-30%] start-1/2 h-[60vmax] w-[60vmax] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgb(155_123_255/0.22),transparent)]" />
      </div>
      <Container size="narrow" className="flex min-h-[70svh] flex-col items-center justify-center gap-6 py-20 text-center">
        <p className="font-display text-[8rem] leading-none font-extralight text-iridescent sm:text-[11rem]" dir="ltr">
          404
        </p>
        <h1 id="not-found-title" className="font-display text-4xl font-extralight text-ink sm:text-5xl">
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
