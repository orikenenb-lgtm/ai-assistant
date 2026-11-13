import { Ticket } from 'lucide-react';
import { SearchPage } from '@/features/search/components/SearchPage';

export default function ActivitiesSearchPage() {
  return (
    <SearchPage
      category="activity"
      title="חיפוש אטרקציות"
      description="פעילויות וסיורים למשפחה לפי תחומי עניין, גילאי ילדים ונגישות."
      icon={<Ticket />}
    />
  );
}
