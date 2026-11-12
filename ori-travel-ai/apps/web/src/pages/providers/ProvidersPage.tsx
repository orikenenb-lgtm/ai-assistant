import { PlugZap } from 'lucide-react';
import { PlaceholderPage } from '@/components/PlaceholderPage';

export default function ProvidersPage() {
  return (
    <PlaceholderPage
      title="ספקים ואבחון"
      icon={<PlugZap />}
      description="מצב החיבור של כל ספק נתונים ובדיקות תקינות."
      planned={['רשימת ספקים עם מצב (תקין / חלקי / נכשל / לא מחובר / מושבת)', 'בדיקת תקינות ידנית ונתוני אבחון', 'הוראות חיבור ספקים רשמיים']}
    />
  );
}
