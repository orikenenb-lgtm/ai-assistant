import { ChevronDown, CircleHelp, LogOut, Monitor, Moon, Settings, Sun } from 'lucide-react';
import { useNavigate } from 'react-router';
import {
  Badge,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui';
import { useAuth } from '@/features/auth';
import { cn } from '@/lib/cn';
import { ROLE_LABELS } from '@/lib/labels';
import { useTheme, type ThemePreference } from './theme';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts[0]?.[0] ?? '?') + (parts[1]?.[0] ?? '');
}

const THEME_OPTIONS: Array<{ value: ThemePreference; label: string; icon: typeof Sun }> = [
  { value: 'system', label: 'לפי הגדרות המכשיר', icon: Monitor },
  { value: 'light', label: 'בהירה', icon: Sun },
  { value: 'dark', label: 'כהה', icon: Moon },
];

function isThemePreference(value: string): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark';
}

export function UserMenu() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { preference, setPreference } = useTheme();
  if (!user) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          'touch-target flex h-10 items-center gap-2 rounded-full border border-line bg-surface ps-1 pe-2 text-sm transition-colors hover:border-line-strong hover:bg-surface-hover sm:pe-3',
        )}
        aria-label={`תפריט משתמש: ${user.display_name}`}
      >
        <span
          className="grid size-8 place-items-center rounded-full bg-accent-soft text-xs font-bold text-accent-strong ring-1 ring-inset ring-accent-line"
          aria-hidden="true"
        >
          {initials(user.display_name)}
        </span>
        <span className="hidden max-w-32 truncate font-medium text-fg sm:inline">{user.display_name}</span>
        <ChevronDown className="size-4 text-fg-subtle" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <div className="px-2.5 pb-2 pt-1.5">
          <p className="truncate font-semibold text-fg">{user.display_name}</p>
          <p className="truncate text-xs text-fg-muted" dir="ltr">
            {user.email}
          </p>
          <Badge tone="accent" size="sm" className="mt-2">
            {ROLE_LABELS[user.role]}
          </Badge>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>ערכת צבעים</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={preference}
          onValueChange={(value) => {
            if (isThemePreference(value)) setPreference(value);
          }}
        >
          {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
            <DropdownMenuRadioItem
              key={value}
              value={value}
              data-testid={`theme-${value}`}
              // Keep the menu open so the change is visible immediately.
              onSelect={(event) => event.preventDefault()}
            >
              <Icon aria-hidden="true" />
              {label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate('/settings')}>
          <Settings aria-hidden="true" />
          הגדרות
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => navigate('/help')}>
          <CircleHelp aria-hidden="true" />
          עזרה
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          tone="danger"
          onSelect={async () => {
            await logout();
            navigate('/login', { replace: true });
          }}
        >
          <LogOut aria-hidden="true" className="rtl:rotate-180" />
          התנתקות
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
