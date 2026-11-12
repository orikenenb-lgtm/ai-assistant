import { BedDouble } from 'lucide-react';
import { PlaceholderPage } from '@/components/PlaceholderPage';

export default function HotelsSearchPage() {
  return (
    <PlaceholderPage
      title="חיפוש מלונות"
      icon={<BedDouble />}
      description="לינה לפי יעד, תאריכים והרכב החדרים."
      planned={[
        'חדרים ותפוסה (מבוגרים וגילאי ילדים), דירוג כוכבים וסוג ארוחות',
        'ביטול חינם, כשרות ונגישות — מוצגים רק כשהספק מציין זאת במפורש',
        'מחיר ללילה ולשהייה, כולל מיסים ועמלות שאינם כלולים',
      ]}
    />
  );
}
