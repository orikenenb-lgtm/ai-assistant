export const AGE_GROUP_LABELS: Record<string, string> = {
  adult: 'מבוגר/ת',
  child: 'ילד/ה',
  infant: 'תינוק/ת',
};

export const INVITATION_STATUS_LABELS: Record<string, string> = {
  pending: 'ממתינה',
  accepted: 'התקבלה',
  expired: 'פגה',
  revoked: 'בוטלה',
};

export const INVITATION_STATUS_TONES = {
  pending: 'info',
  accepted: 'success',
  expired: 'muted',
  revoked: 'muted',
} as const;

export const GENDER_LABELS: Record<string, string> = { male: 'זכר', female: 'נקבה', other: 'אחר' };
export const SEAT_LABELS: Record<string, string> = { window: 'ליד החלון', aisle: 'במעבר', middle: 'באמצע', none: 'ללא העדפה' };
export const MEAL_LABELS: Record<string, string> = {
  regular: 'רגילה',
  kosher: 'כשרה',
  vegetarian: 'צמחונית',
  vegan: 'טבעונית',
  gluten_free: 'ללא גלוטן',
  child: 'ארוחת ילדים',
};
