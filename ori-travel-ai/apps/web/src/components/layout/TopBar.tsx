import { Menu } from 'lucide-react';
import { Link } from 'react-router';
import { IconButton } from '@/components/ui';
import { NotificationsBell } from '@/features/notifications/components/NotificationsBell';
import { DataModeIndicator } from '@/features/providers/components/DataModeIndicator';
import { Logo } from './Logo';
import { UserMenu } from './UserMenu';

export function TopBar({ onOpenMenu }: { onOpenMenu: () => void }) {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur-md supports-[backdrop-filter]:bg-surface/85">
      <div className="mx-auto flex h-[var(--spacing-topbar)] max-w-7xl items-center gap-2 px-3 sm:px-6 lg:px-10">
        <div className="flex min-w-0 items-center gap-1 lg:hidden">
          <IconButton label="פתיחת תפריט הניווט" icon={<Menu />} onClick={onOpenMenu} showTooltip={false} />
          <Link to="/" aria-label="Ori Travel AI — דף הבית" className="rounded-md">
            <Logo compact />
          </Link>
        </div>
        <div className="ms-auto flex items-center gap-1.5 sm:gap-2.5">
          <DataModeIndicator />
          <NotificationsBell />
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
