import { Compass } from 'lucide-react';
import { ButtonLink, Card, PageHeader } from '@/components/ui';

export default function NotFoundPage() {
  return (
    <>
      <PageHeader title="הדף לא נמצא" documentTitle="הדף לא נמצא" />
      <Card padding="lg" className="flex flex-col items-center gap-4 text-center">
        <span className="grid size-16 place-items-center rounded-full bg-sea-50 text-sea-700" aria-hidden="true">
          <Compass className="size-8" />
        </span>
        <p className="text-5xl font-bold text-ink-200" aria-hidden="true">
          404
        </p>
        <p className="max-w-md text-sm leading-relaxed text-fg-muted">
          נראה שהקישור שגוי או שהדף הועבר. אפשר לחזור לדף הבית או לעיין במרכז העזרה.
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          <ButtonLink to="/">לדף הבית</ButtonLink>
          <ButtonLink to="/help" variant="secondary">
            עזרה
          </ButtonLink>
        </div>
      </Card>
    </>
  );
}
