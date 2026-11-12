/** Shared Hebrew labels for enums used across features. */
import type { Role } from './schemas/auth';
import type { Category } from './schemas/common';

export const CATEGORY_LABELS: Record<Category, string> = {
  flight: 'טיסות',
  hotel: 'מלונות',
  car: 'רכבים',
  activity: 'אטרקציות',
};

export const CATEGORY_SINGULAR: Record<Category, string> = {
  flight: 'טיסה',
  hotel: 'מלון',
  car: 'רכב',
  activity: 'אטרקציה',
};

export const CATEGORY_SEARCH_PATH: Record<Category, string> = {
  flight: '/search/flights',
  hotel: '/search/hotels',
  car: '/search/cars',
  activity: '/search/activities',
};

export const ROLE_LABELS: Record<Role, string> = {
  owner: 'בעלים',
  adult: 'מבוגר/ת',
  viewer: 'צופה',
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  owner: 'ניהול המשפחה, ספקים והגדרות שרת',
  adult: 'יצירה ועריכה של טיולים, בני משפחה והתראות',
  viewer: 'צפייה וחיפוש בלבד',
};
