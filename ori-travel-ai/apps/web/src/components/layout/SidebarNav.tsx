import { NavLink } from 'react-router';
import { cn } from '@/lib/cn';
import { Logo } from './Logo';
import { NAV_GROUPS } from './nav';

/** Navigation content shared by the desktop sidebar and the mobile drawer (light surface). */
export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-[var(--spacing-topbar)] shrink-0 items-center px-5">
        <NavLink to="/" onClick={onNavigate} aria-label="Ori Travel AI — דף הבית" className="rounded-md">
          <Logo />
        </NavLink>
      </div>
      {/* The whole area scrolls (nav + footer note) so nothing is hidden behind a fixed footer. */}
      <div className="scrollbar-thin flex flex-1 flex-col overflow-y-auto">
        <nav aria-label="ניווט ראשי" className="flex-1 px-3 pb-6 pt-1">
          {NAV_GROUPS.map((group) => (
            <div key={group.id} className="mt-5 first:mt-1">
              {group.label && <h2 className="mb-1 px-3 text-2xs font-semibold text-fg-subtle">{group.label}</h2>}
              <ul className="flex flex-col gap-px">
                {group.items.map((item) => (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      end={item.end}
                      onClick={onNavigate}
                      className={({ isActive }) =>
                        cn(
                          'group relative flex h-9 items-center gap-3 rounded-md px-3 text-sm transition-colors pointer-coarse:h-touch',
                          isActive
                            ? 'bg-accent-soft font-semibold text-accent-strong before:absolute before:inset-y-1.5 before:start-0 before:w-[3px] before:rounded-full before:bg-accent'
                            : 'font-medium text-fg-muted hover:bg-surface-hover hover:text-fg',
                        )
                      }
                    >
                      {({ isActive }) => (
                        <>
                          <item.icon
                            className={cn(
                              'size-[1.125rem] shrink-0',
                              isActive ? 'text-accent' : 'text-fg-subtle group-hover:text-fg-muted',
                            )}
                            aria-hidden="true"
                          />
                          <span className="truncate">{item.label}</span>
                        </>
                      )}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
        <p className="shrink-0 border-t border-line px-5 py-4 text-xs leading-relaxed text-fg-subtle">
          פלטפורמה משפחתית פרטית · ללא רכישות אמיתיות
        </p>
      </div>
    </div>
  );
}
