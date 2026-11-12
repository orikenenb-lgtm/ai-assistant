import * as Menu from '@radix-ui/react-dropdown-menu';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';
import { APP_DIR } from '@/lib/dir';

/** Dropdown menu root (RTL-aware keyboard navigation). */
export function DropdownMenu({ dir = APP_DIR, modal = false, ...rest }: ComponentProps<typeof Menu.Root>) {
  return <Menu.Root dir={dir} modal={modal} {...rest} />;
}

export const DropdownMenuTrigger = Menu.Trigger;
export const DropdownMenuGroup = Menu.Group;

export function DropdownMenuContent({ className, sideOffset = 8, align = 'end', ...rest }: ComponentProps<typeof Menu.Content>) {
  return (
    <Menu.Portal>
      <Menu.Content
        sideOffset={sideOffset}
        align={align}
        collisionPadding={12}
        className={cn(
          'z-[60] min-w-56 max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-xl border border-line bg-surface p-1.5 text-fg shadow-lg animate-pop-in',
          className,
        )}
        {...rest}
      />
    </Menu.Portal>
  );
}

export function DropdownMenuItem({
  className,
  tone = 'default',
  ...rest
}: ComponentProps<typeof Menu.Item> & { tone?: 'default' | 'danger' }) {
  return (
    <Menu.Item
      className={cn(
        'flex cursor-pointer select-none items-center gap-2.5 rounded-md px-2.5 py-2 text-sm outline-none',
        'data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
        tone === 'danger'
          ? 'text-coral-700 data-[highlighted]:bg-coral-50'
          : 'text-fg data-[highlighted]:bg-sand-100',
        className,
      )}
      {...rest}
    />
  );
}

export function DropdownMenuLabel({ className, ...rest }: ComponentProps<typeof Menu.Label>) {
  return <Menu.Label className={cn('px-2.5 py-2 text-xs font-semibold text-fg-muted', className)} {...rest} />;
}

export function DropdownMenuSeparator({ className, ...rest }: ComponentProps<typeof Menu.Separator>) {
  return <Menu.Separator className={cn('-mx-1.5 my-1.5 h-px bg-line', className)} {...rest} />;
}
