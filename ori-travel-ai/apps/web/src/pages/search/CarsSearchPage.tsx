import { Car } from 'lucide-react';
import { PlaceholderPage } from '@/components/PlaceholderPage';

export default function CarsSearchPage() {
  return (
    <PlaceholderPage
      title="השכרת רכב"
      icon={<Car />}
      description="רכב לטיול: איסוף והחזרה, גיל נהג וסוג רכב."
      planned={[
        'מקום וזמן איסוף והחזרה, גיל הנהג, סוג רכב, תיבת הילוכים ומספר מושבים',
        'פירוט ביטוחים כלולים, פיקדון, מדיניות דלק ועמלות נהג צעיר',
      ]}
    />
  );
}
