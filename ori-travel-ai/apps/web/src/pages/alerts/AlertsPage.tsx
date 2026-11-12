import { BellRing } from 'lucide-react';
import { PlaceholderPage } from '@/components/PlaceholderPage';

export default function AlertsPage() {
  return (
    <PlaceholderPage
      title="התראות מחיר"
      icon={<BellRing />}
      description="מעקב אחרי מחירים לחיפושים שמורים."
      planned={['מחיר יעד והתראה כשהמחיר יורד', 'היסטוריית בדיקות ובדיקה ידנית', 'הבדיקות האוטומטיות פועלות רק אם הופעלו בשרת']}
    />
  );
}
