import { ClipboardCheck } from 'lucide-react';
import { useParams } from 'react-router';
import { PlaceholderPage } from '@/components/PlaceholderPage';

export default function BookingDetailPage() {
  const { bookingId } = useParams();
  return (
    <PlaceholderPage
      title="פרטי הזמנה"
      icon={<ClipboardCheck />}
      description={`סטטוס, נוסעים, תנאים והיסטוריה של ההזמנה (מזהה: ${bookingId ?? '—'}).`}
    />
  );
}
