import type { Metadata } from "next";
import { Button } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";

export const metadata: Metadata = {
  title: "העמוד לא נמצא",
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <section aria-labelledby="not-found-title" className="grain relative isolate overflow-hidden">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute top-[-30%] start-1/2 h-[60vmax] w-[60vmax] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgb(255_42_95/0.3),transparent)]" />
      </div>
      <Container size="narrow" className="flex min-h-[70svh] flex-col items-center justify-center gap-6 py-20 text-center">
        <p className="font-display text-[10rem] leading-[0.8] font-bold text-cherry sm:text-[14rem]" dir="ltr">
          404
        </p>
        <h1 id="not-found-title" className="font-display text-6xl leading-none font-bold text-cream sm:text-7xl">
          העמוד שחיפשת לא נמצא
        </h1>
        <p className="max-w-md text-lg leading-relaxed text-mist">
          ייתכן שהקישור שגוי או שהעמוד הוסר. אפשר לחזור לעמוד הבית ולהמשיך משם.
        </p>
        <Button href="/" size="lg">
          חזרה לעמוד הבית
        </Button>
      </Container>
    </section>
  );
}
