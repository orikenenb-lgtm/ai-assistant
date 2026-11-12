import { Scale } from 'lucide-react';
import { PlaceholderPage } from '@/components/PlaceholderPage';

export default function ComparePage() {
  return (
    <PlaceholderPage
      title="השוואת הצעות"
      icon={<Scale />}
      description="השוואה של 2–10 הצעות זו לצד זו, עם הסבר לניקוד."
      planned={[
        'ניקוד שקוף לפי עלות (40%), נוחות (25%), גמישות (20%) ואיכות (15%) — ניתן לשינוי בהגדרות',
        'קיבוץ לפי קטגוריה ומטבע; הצעות במטבעות שונים ללא שער המרה מסומנות כלא ברות השוואה',
      ]}
    />
  );
}
