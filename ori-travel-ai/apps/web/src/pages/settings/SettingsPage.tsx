import { Settings } from 'lucide-react';
import { PlaceholderPage } from '@/components/PlaceholderPage';

export default function SettingsPage() {
  return (
    <PlaceholderPage
      title="הגדרות"
      icon={<Settings />}
      description="העדפות המשפחה, החשבון והשרת."
      planned={['משקלי דירוג ההשוואה ומטבע תצוגה', 'שינוי סיסמה', 'הגדרות מפה, תזמון בדיקות ושמירת נתונים (לבעלים)']}
    />
  );
}
