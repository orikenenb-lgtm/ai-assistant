import { BedDouble } from 'lucide-react';
import { SearchPage } from '@/features/search/components/SearchPage';

export default function HotelsSearchPage() {
  return (
    <SearchPage
      category="hotel"
      title="חיפוש מלונות"
      description="מלונות לפי חדרים וגילאי ילדים, עם מדיניות ביטול, ארוחות ועלויות שאינן כלולות."
      icon={<BedDouble />}
    />
  );
}
