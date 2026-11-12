import { NavLink } from 'react-router';
import { cn } from '@/lib/cn';
import { Logo } from './Logo';
import { NAV_GROUPS } from './nav';

/** Navigation content shared by the desktop sidebar and the mobile drawer (dark surface). */
export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-[var(--spacing-topbar)] shrink-0 items-center px-5">
        <NavLink to="/" onClick={onNavigate} aria-label="Ori Travel AI — דף הבית" className="rounded-md">
          <Logo tone="light" />
        </NavLink>
      </div>
      {/* The whole area scrolls (nav + footer note) so nothing is hidden behind a fixed footer. */}
      <div className="scrollbar-thin flex flex-1 flex-col overflow-y-auto">
        <nav aria-label="ניווט ראשי" className="flex-1 px-3 pb-6 pt-2">
          {NAV_GROUPS.map((group) => (
            <div key={group.id} className="mt-4 first:mt-1">
              {group.label && (
                <h2 className="mb-1.5 px-3 text-[0.7rem] font-semibold tracking-wider text-ink-300">{group.label}</h2>
              )}
              <ul className="flex flex-col gap-0.5">
                {group.items.map((item) => (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      end={item.end}
                      onClick={onNavigate}
                      className={({ isActive }) =>
                        cn(
                          'group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                          isActive
                            ? 'bg-white/10 text-white before:absolute before:inset-y-2 before:start-0 before:w-1 before:rounded-full before:bg-sun-400'
                            : 'text-ink-200 hover:bg-white/5 hover:text-white',
                        )
                      }
                    >
                      {({ isActive }) => (
                        <>
                          <item.icon
                            className={cn(
                              'size-[1.125rem] shrink-0',
                              isActive ? 'text-sun-400' : 'text-ink-300 group-hover:text-sea-300',
                            )}
                            aria-hidden="true"
                          />
                          <span>{item.label}</span>
                        </>
                      )}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
        <p className="shrink-0 border-t border-white/10 px-5 py-4 text-xs leading-relaxed text-ink-300">
          פלטפורמה משפחתית פרטית · ללא רכישות אמיתיות
        </p>
      </div>
    </div>
  );
}
