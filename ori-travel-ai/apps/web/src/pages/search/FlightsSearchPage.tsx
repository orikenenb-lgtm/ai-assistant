import { Plane } from 'lucide-react';
import { SearchPage } from '@/features/search/components/SearchPage';

export default function FlightsSearchPage() {
  return (
    <SearchPage
      category="flight"
      title="חיפוש טיסות"
      description="טיסות הלוך-חזור או בכיוון אחד, עם השוואה שקופה בין ספקים."
      icon={<Plane />}
    />
  );
}
