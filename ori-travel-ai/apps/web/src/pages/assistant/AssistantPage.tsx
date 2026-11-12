import { Sparkles } from 'lucide-react';
import { PlaceholderPage } from '@/components/PlaceholderPage';

export default function AssistantPage() {
  return (
    <PlaceholderPage
      title="עוזר AI"
      icon={<Sparkles />}
      description="שיחה בעברית לחיפוש ותכנון טיולים משפחתיים."
      planned={[
        'בקשות חופשיות בעברית ("טיסה לאתונה לשני מבוגרים וילד בדצמבר") שהופכות לחיפוש אמיתי במערכת',
        'כרטיסי הצעות עם מקור הנתונים (הדגמה / חי / שמור במטמון) — העוזר אינו ממציא מחירים',
        'שאלות הבהרה כשחסר מידע, ותכנון יומי מבוסס תוצאות חיפוש אטרקציות',
        'העוזר לעולם אינו מבצע הזמנה או תשלום',
      ]}
    />
  );
}
