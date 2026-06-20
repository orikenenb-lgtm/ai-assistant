// Feature flag ל-CRM. כבוי כברירת מחדל בקוד (כדי שבלי הדגל המערכת זהה להיום);
// בבניית הפרודקשן (Dockerfile) מוגדר VITE_ENABLE_CRM=1 כדי להפעיל.
export const CRM_ENABLED =
  import.meta.env.VITE_ENABLE_CRM === '1' || import.meta.env.VITE_ENABLE_CRM === 'true'
