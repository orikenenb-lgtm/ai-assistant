import { Route } from 'lucide-react';
import { useParams } from 'react-router';
import { PlaceholderPage } from '@/components/PlaceholderPage';

export default function TripDetailPage() {
  const { tripId } = useParams();
  return (
    <PlaceholderPage
      title="פרטי טיול"
      icon={<Route />}
      description={`מסלול, פריטים, נוסעים ותקציב של הטיול (מזהה: ${tripId ?? '—'}).`}
      planned={['ציר זמן יומי עם גרירה לשינוי סדר', 'סיכום תקציב ואזהרות', 'ייצוא ליומן (ICS) ול-PDF בעברית']}
    />
  );
}
