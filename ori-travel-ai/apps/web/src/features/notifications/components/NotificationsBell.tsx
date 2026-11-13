import { Bell, CheckCheck } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  FreshnessText,
  Spinner,
  buttonClasses,
} from '@/components/ui';
import { cn } from '@/lib/cn';
import { useMarkAllNotificationsRead, useMarkNotificationRead, useRecentNotifications, useUnreadCount } from '../hooks';

function isSafeInternalLink(link: string | null | undefined): link is string {
  return !!link && link.startsWith('/') && !link.startsWith('//');
}

/** Bell with unread count (polled every 60s). Hidden entirely if the API is unavailable. */
export function NotificationsBell() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const unread = useUnreadCount();
  const recent = useRecentNotifications(open);
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();

  if (unread.isError) return null;
  const count = unread.data?.count ?? 0;
  const label = count > 0 ? `התראות: ${count} שלא נקראו` : 'התראות';

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        aria-label={label}
        className={cn(buttonClasses({ variant: 'ghost', size: 'md' }), 'relative size-10 px-0 [&_svg]:size-5')}
      >
        <Bell aria-hidden="true" />
        {count > 0 && (
          <span
            aria-hidden="true"
            className="absolute end-1 top-1 grid h-[1.125rem] min-w-[1.125rem] place-items-center rounded-full bg-coral-600 px-1 text-[0.65rem] font-bold leading-none text-white ring-2 ring-surface"
          >
            {count > 99 ? '99+' : count}
          </span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-80">
        <div className="flex items-center justify-between gap-2 pe-1">
          <DropdownMenuLabel>התראות</DropdownMenuLabel>
          {count > 0 && (
            <button
              type="button"
              className={cn(buttonClasses({ variant: 'ghost', size: 'sm' }), 'h-7 px-2 text-xs')}
              onClick={() => markAll.mutate()}
              disabled={markAll.isPending}
            >
              <CheckCheck aria-hidden="true" />
              סימון הכל כנקרא
            </button>
          )}
        </div>
        <DropdownMenuSeparator />
        {recent.isPending ? (
          <div className="grid place-items-center py-6 text-fg-subtle">
            <Spinner />
          </div>
        ) : recent.isError ? (
          <p className="px-3 py-4 text-sm text-fg-muted">לא ניתן לטעון התראות כרגע.</p>
        ) : recent.data.items.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-fg-muted">אין התראות חדשות</p>
        ) : (
          <div className="scrollbar-thin max-h-80 overflow-y-auto">
            {recent.data.items.map((n) => (
              <DropdownMenuItem
                key={n.id}
                className="flex-col items-start gap-0.5"
                onSelect={() => {
                  if (!n.read_at) markRead.mutate(n.id);
                  if (isSafeInternalLink(n.link)) navigate(n.link);
                }}
              >
                <span className="flex w-full items-center gap-2">
                  {!n.read_at && <span className="size-2 shrink-0 rounded-full bg-sea-500" aria-label="לא נקראה" />}
                  <span className={cn('flex-1 truncate', !n.read_at && 'font-semibold')}>{n.title}</span>
                </span>
                {n.body && <span className="line-clamp-2 text-xs text-fg-muted">{n.body}</span>}
                <FreshnessText value={n.created_at} prefix="" className="text-[0.7rem] text-fg-subtle" />
              </DropdownMenuItem>
            ))}
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
