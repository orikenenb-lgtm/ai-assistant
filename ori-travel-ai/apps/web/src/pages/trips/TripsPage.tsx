import { Luggage } from 'lucide-react';
import { PlaceholderPage } from '@/components/PlaceholderPage';

export default function TripsPage() {
  return (
    <PlaceholderPage
      title="טיולים"
      icon={<Luggage />}
      description="תכנון טיולים משפחתיים מקצה לקצה."
      planned={[
        'יצירת טיול עם יעד, תאריכים, נוסעים ותקציב',
        'מסלול יומי, הוספת הצעות מתוצאות חיפוש ופריטים ידניים',
        'מעקב תקציב לפי מטבע (ידוע / משוער / לא כלול) וייצוא ליומן ול-PDF',
      ]}
    />
  );
}
