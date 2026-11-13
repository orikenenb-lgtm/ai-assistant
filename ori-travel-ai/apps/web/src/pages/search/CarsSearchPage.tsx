import { Car } from 'lucide-react';
import { SearchPage } from '@/features/search/components/SearchPage';

export default function CarsSearchPage() {
  return (
    <SearchPage
      category="car"
      title="חיפוש רכבים"
      description="השכרת רכב עם איסוף והחזרה, גיל נהג, ביטוחים כלולים ופיקדון."
      icon={<Car />}
    />
  );
}
