import { Users } from 'lucide-react';
import { PlaceholderPage } from '@/components/PlaceholderPage';

export default function FamilyPage() {
  return (
    <PlaceholderPage
      title="בני משפחה"
      icon={<Users />}
      description="בני המשפחה, פרופילי נוסעים והזמנות להצטרפות."
      planned={[
        'פרופילי נוסעים מוצפנים; מספרי דרכון מוסתרים וחשיפתם מחייבת אימות סיסמה',
        'הזמנת בני משפחה לפי תפקיד (בעלים / מבוגר/ת / צופה)',
      ]}
    />
  );
}
