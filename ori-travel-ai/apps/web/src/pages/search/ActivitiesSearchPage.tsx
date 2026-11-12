import { Ticket } from 'lucide-react';
import { PlaceholderPage } from '@/components/PlaceholderPage';

export default function ActivitiesSearchPage() {
  return (
    <PlaceholderPage
      title="אטרקציות ופעילויות"
      icon={<Ticket />}
      description="פעילויות לפי יעד, תאריכים ותחומי עניין."
      planned={[
        'תחומי עניין (מוזיאונים, סיורים, טבע, אוכל ועוד), משתתפים לפי גילאים',
        'סימון התאמה למשפחות, גיל מינימלי ונגישות',
      ]}
    />
  );
}
