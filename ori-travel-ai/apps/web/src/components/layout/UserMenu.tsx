import { ChevronDown, CircleHelp, LogOut, Settings } from 'lucide-react';
import { useNavigate } from 'react-router';
import {
  Badge,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui';
import { useAuth } from '@/features/auth';
import { cn } from '@/lib/cn';
import { ROLE_LABELS } from '@/lib/labels';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts[0]?.[0] ?? '?') + (parts[1]?.[0] ?? '');
}

export function UserMenu() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  if (!user) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          'flex h-10 items-center gap-2 rounded-full border border-line bg-surface ps-1 pe-2 text-sm shadow-xs transition-colors hover:border-line-strong sm:pe-3',
        )}
        aria-label={`תפריט משתמש: ${user.display_name}`}
      >
        <span
          className="grid size-8 place-items-center rounded-full bg-ink-900 text-xs font-bold text-sun-300"
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
