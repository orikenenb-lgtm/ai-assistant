import { Bed, Bus, Car, Circle, Plane, StickyNote, Ticket, type LucideIcon } from 'lucide-react';
import type { ItemCostStatus, ItemKind, TripStatus } from '@/lib/schemas/trips';

export const ITEM_KIND_LABELS: Record<ItemKind, string> = {
  flight: 'טיסה',
  hotel: 'לינה',
  car: 'רכב',
  activity: 'אטרקציה',
  transfer: 'הסעה',
  note: 'הערה',
  other: 'אחר',
};

export const ITEM_KIND_ICONS: Record<ItemKind, LucideIcon> = {
  flight: Plane,
  hotel: Bed,
  car: Car,
  activity: Ticket,
  transfer: Bus,
  note: StickyNote,
  other: Circle,
};

export function kindLabel(kind: string): string {
  return ITEM_KIND_LABELS[kind as ItemKind] ?? kind;
}

export function kindIcon(kind: string): LucideIcon {
  return ITEM_KIND_ICONS[kind as ItemKind] ?? Circle;
}

export const COST_STATUS_LABELS: Record<ItemCostStatus, string> = {
  known: 'ידוע',
  estimate: 'הערכה',
  excluded: 'לא נכלל',
};

export const COST_STATUS_HELP: Record<ItemCostStatus, string> = {
  known: 'מחיר מדויק שנקבע',
  estimate: 'הערכה — נספרת בתקציב אבל מסומנת כמשוערת',
  excluded: 'לא נספר בסכום התקציב',
};

export const TRIP_STATUS_LABELS: Record<TripStatus, string> = {
  planning: 'בתכנון',
  booked: 'הוזמן',
  completed: 'הסתיים',
  cancelled: 'בוטל',
};

export function tripStatusLabel(status: string | undefined): string {
  return status ? (TRIP_STATUS_LABELS[status as TripStatus] ?? status) : '';
}

export const BUDGET_KIND_ORDER = ['flight', 'hotel', 'car', 'activity', 'transfer', 'note', 'other'] as const;

export const TIMEZONES: Array<{ id: string; label: string }> = [
  { id: 'Asia/Jerusalem', label: 'ישראל (ירושלים)' },
  { id: 'Europe/London', label: 'לונדון' },
  { id: 'Europe/Paris', label: 'פריז / ברלין / רומא / מדריד' },
  { id: 'Europe/Athens', label: 'אתונה / בוקרשט / קפריסין' },
  { id: 'Europe/Istanbul', label: 'איסטנבול' },
  { id: 'Europe/Moscow', label: 'מוסקבה' },
  { id: 'Asia/Dubai', label: 'דובאי' },
  { id: 'Asia/Bangkok', label: 'בנגקוק' },
  { id: 'Asia/Tokyo', label: 'טוקיו' },
  { id: 'Asia/Singapore', label: 'סינגפור' },
  { id: 'Australia/Sydney', label: 'סידני' },
  { id: 'America/New_York', label: 'ניו יורק' },
  { id: 'America/Chicago', label: 'שיקגו' },
  { id: 'America/Denver', label: 'דנבר' },
  { id: 'America/Los_Angeles', label: 'לוס אנג׳לס' },
  { id: 'America/Sao_Paulo', label: 'סאו פאולו' },
  { id: 'UTC', label: 'UTC' },
];

export const CURRENCIES = ['ILS', 'USD', 'EUR', 'GBP', 'CHF', 'CAD', 'AUD', 'JPY', 'AED', 'THB', 'TRY', 'PLN', 'CZK', 'HUF'] as const;
