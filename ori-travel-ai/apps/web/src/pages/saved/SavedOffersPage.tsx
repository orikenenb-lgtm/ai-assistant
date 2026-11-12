import { Bookmark } from 'lucide-react';
import { PlaceholderPage } from '@/components/PlaceholderPage';

export default function SavedOffersPage() {
  return (
    <PlaceholderPage
      title="הצעות שמורות"
      icon={<Bookmark />}
      description="רשימה אישית של הצעות ששמרתם לבדיקה מאוחרת יותר."
      planned={['הערות אישיות לכל הצעה ושיוך לטיול', 'מעבר מהיר להשוואה בין הצעות שמורות']}
    />
  );
}
