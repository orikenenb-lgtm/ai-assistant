// Feature flag לקטלוג. כבוי כברירת מחדל — נדלק רק אחרי אישור (staging).
export const CATALOG_ENABLED =
  import.meta.env.VITE_ENABLE_CATALOG === '1' || import.meta.env.VITE_ENABLE_CATALOG === 'true'
