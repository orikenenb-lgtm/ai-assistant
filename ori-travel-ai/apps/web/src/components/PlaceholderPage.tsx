import { Hammer } from 'lucide-react';
import type { ReactNode } from 'react';
import { Callout, Card, PageHeader } from '@/components/ui';

export interface PlaceholderPageProps {
  title: string;
  description: string;
  icon: ReactNode;
  /** Honest, text-only list of what this screen will offer. */
  planned?: string[];
  children?: ReactNode;
}

/**
 * Honest placeholder for screens built in a later stage.
 * No fake controls or sample data — replace the whole page file when implementing.
 */
export function PlaceholderPage({ title, description, icon, planned, children }: PlaceholderPageProps) {
  return (
    <>
      <PageHeader title={title} description={description} icon={icon} />
      <div className="flex flex-col gap-5">
        <Callout tone="info" icon={<Hammer />} title="מסך זה ייבנה בשלב הבא">
          המסך עדיין בפיתוח. אין כאן נתונים או פעולות — כדי שלא ייווצר רושם שגוי לגבי מה שהמערכת יודעת לעשות כרגע.
        </Callout>
        {planned && planned.length > 0 && (
          <Card>
            <h2 className="text-base font-semibold text-fg">מה יהיה כאן</h2>
            <ul className="mt-3 flex list-disc flex-col gap-1.5 ps-5 text-sm leading-relaxed text-fg-muted marker:text-sea-500">
              {planned.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </Card>
        )}
        {children}
      </div>
    </>
  );
}
