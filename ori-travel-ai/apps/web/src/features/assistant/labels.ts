export const TOOL_LABELS: Record<string, string> = {
  search_flights: 'חיפוש טיסות',
  search_hotels: 'חיפוש מלונות',
  search_cars: 'חיפוש רכבים',
  search_activities: 'חיפוש אטרקציות',
  list_trips: 'קריאת רשימת טיולים',
  get_trip: 'קריאת טיול',
  save_offer: 'שמירת הצעה',
};

export const TOOL_STATUS_LABELS: Record<string, string> = {
  ok: 'הושלם',
  error: 'נכשל',
  rejected: 'נדחה',
  skipped: 'דולג',
};

export const EXAMPLE_PROMPTS = [
  'טיסה לרומא ב-12 בדצמבר לשני מבוגרים וילד בן 6',
  'מלון באתונה ל-4 לילות עם ארוחת בוקר',
  'אטרקציות לילדים בברצלונה',
] as const;

export const PLAN_INTERESTS = ['family', 'museum', 'outdoor', 'food', 'water', 'culture', 'tour', 'adventure'] as const;
