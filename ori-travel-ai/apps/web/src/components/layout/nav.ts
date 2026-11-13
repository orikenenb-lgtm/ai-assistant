import {
  BedDouble,
  BellRing,
  Bookmark,
  CalendarRange,
  Car,
  CircleHelp,
  ClipboardCheck,
  LayoutDashboard,
  Luggage,
  Plane,
  PlugZap,
  Scale,
  Search,
  Settings,
  Sparkles,
  Ticket,
  Users,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Exact match only (for "/"). */
  end?: boolean;
}

export interface NavGroup {
  id: string;
  /** Group heading (omit for the top-level home link). */
  label?: string;
  items: NavItem[];
}

/** Sidebar navigation (single source of truth — add new areas here). */
export const NAV_GROUPS: NavGroup[] = [
  { id: 'home', items: [{ to: '/', label: 'ראשי', icon: LayoutDashboard, end: true }] },
  {
    id: 'search',
    label: 'חיפוש',
    items: [
      { to: '/assistant', label: 'עוזר AI', icon: Sparkles },
      { to: '/search/flights', label: 'טיסות', icon: Plane },
      { to: '/cheapest-year', label: 'הזול בשנה', icon: CalendarRange },
      { to: '/search/hotels', label: 'מלונות', icon: BedDouble },
      { to: '/search/cars', label: 'רכבים', icon: Car },
      { to: '/search/activities', label: 'אטרקציות', icon: Ticket },
      { to: '/compare', label: 'השוואה', icon: Scale },
    ],
  },
  {
    id: 'plan',
    label: 'תכנון',
    items: [
      { to: '/trips', label: 'טיולים', icon: Luggage },
      { to: '/saved', label: 'הצעות שמורות', icon: Bookmark },
      { to: '/alerts', label: 'התראות מחיר', icon: BellRing },
    ],
  },
  { id: 'bookings', label: 'הזמנות', items: [{ to: '/bookings', label: 'סקירת הזמנות', icon: ClipboardCheck }] },
  { id: 'family', label: 'משפחה', items: [{ to: '/family', label: 'בני משפחה', icon: Users }] },
  {
    id: 'system',
    label: 'מערכת',
    items: [
      { to: '/providers', label: 'ספקים ואבחון', icon: PlugZap },
      { to: '/settings', label: 'הגדרות', icon: Settings },
      { to: '/help', label: 'עזרה', icon: CircleHelp },
    ],
  },
];

export interface TabItem extends NavItem {
  /** Path prefixes that mark this tab active. */
  matches: string[];
}

/** Mobile bottom tab bar — the most used areas. */
export const TAB_ITEMS: TabItem[] = [
  { to: '/', label: 'ראשי', icon: LayoutDashboard, end: true, matches: [] },
  { to: '/search/flights', label: 'חיפוש', icon: Search, matches: ['/search', '/compare'] },
  { to: '/assistant', label: 'עוזר AI', icon: Sparkles, matches: ['/assistant'] },
  { to: '/trips', label: 'טיולים', icon: Luggage, matches: ['/trips', '/saved', '/alerts'] },
  { to: '/bookings', label: 'הזמנות', icon: ClipboardCheck, matches: ['/bookings'] },
];
