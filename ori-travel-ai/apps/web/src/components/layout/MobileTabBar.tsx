import { NavLink, useLocation } from 'react-router';
import { cn } from '@/lib/cn';
import { TAB_ITEMS } from './nav';

function isTabActive(pathname: string, item: (typeof TAB_ITEMS)[number]): boolean {
  if (item.end) return pathname === item.to;
  return item.matches.some((m) => pathname === m || pathname.startsWith(`${m}/`));
}

/** Bottom tab bar for small screens (hidden from lg up). */
export function MobileTabBar() {
  const { pathname } = useLocation();
  return (
    <nav
      aria-label="ניווט מהיר"
      className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 backdrop-blur lg:hidden"
    >
      <ul className="mx-auto grid h-[var(--spacing-tabbar)] max-w-lg grid-cols-5">
        {TAB_ITEMS.map((item) => {
          const active = isTabActive(pathname, item);
          return (
            <li key={item.to} className="flex">
              <NavLink
                to={item.to}
                end={item.end}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex flex-1 flex-col items-center justify-center gap-1 text-[0.7rem] font-medium transition-colors',
                  active ? 'text-sea-700' : 'text-fg-muted hover:text-fg',
                )}
              >
                <span
                  className={cn(
                    'grid h-7 w-12 place-items-center rounded-full transition-colors',
                    active ? 'bg-sea-50' : 'bg-transparent',
                  )}
                  aria-hidden="true"
                >
                  <item.icon className="size-5" />
                </span>
                {item.label}
              </NavLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
