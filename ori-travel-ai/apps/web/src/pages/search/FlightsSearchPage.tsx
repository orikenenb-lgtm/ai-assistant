import { Plane } from 'lucide-react';
import { PlaceholderPage } from '@/components/PlaceholderPage';

export default function FlightsSearchPage() {
  return (
    <PlaceholderPage
      title="חיפוש טיסות"
      icon={<Plane />}
      description="טיסות הלוך-חזור או בכיוון אחד, עם השוואה שקופה בין ספקים."
      planned={[
        'מוצא ויעד, תאריכים עם גמישות של עד ±3 ימים, נוסעים לפי גילאים ומחלקה',
        'סינון לפי מספר עצירות, כבודה וחלון שעות המראה',
        'תוצאות עם פירוט מחיר (כלול / משוער / לא כלול), זמנים מקומיים ומדיניות ביטול',
      ]}
    />
  );
}
