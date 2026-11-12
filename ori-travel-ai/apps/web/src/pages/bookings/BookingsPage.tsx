import { ClipboardCheck } from 'lucide-react';
import { PlaceholderPage } from '@/components/PlaceholderPage';

export default function BookingsPage() {
  return (
    <PlaceholderPage
      title="סקירת הזמנות"
      icon={<ClipboardCheck />}
      description="הכנת הזמנות בצורה בטוחה — ללא רכישה אמיתית מתוך המערכת."
      planned={[
        'בדיקת מחיר חוזרת מול הספק לפני אישור',
        'אישור תנאים מפורש עם הזנת סיסמה; שינוי מהותי מבטל את האישור',
        'שליחה בסימולציה בלבד, או מעבר לאתר הרשמי של הספק ותיעוד מספר האישור',
      ]}
    />
  );
}
