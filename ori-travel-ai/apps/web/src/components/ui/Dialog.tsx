import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { useState, type ReactElement, type ReactNode } from 'react';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { Button } from './Button';
import { Callout } from './Callout';

const SIZES = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' } as const;

export interface DialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Optional trigger element (rendered with asChild). */
  trigger?: ReactElement;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: keyof typeof SIZES;
  hideCloseButton?: boolean;
  className?: string;
}

/** Modal dialog: focus trap, Escape closes, focus returns to the trigger. */
export function Dialog({
  open,
  onOpenChange,
  trigger,
  title,
  description,
  children,
  footer,
  size = 'md',
  hideCloseButton = false,
  className,
}: DialogProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      {trigger && <DialogPrimitive.Trigger asChild>{trigger}</DialogPrimitive.Trigger>}
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-ink-950/50 p-4 backdrop-blur-[2px] animate-fade-in">
          <DialogPrimitive.Content
            {...(description ? {} : { 'aria-describedby': undefined })}
            className={cn(
              'relative w-full rounded-2xl border border-line bg-surface p-6 text-fg shadow-lg animate-pop-in focus:outline-none',
              SIZES[size],
              className,
            )}
          >
            <div className="pe-8">
              <DialogPrimitive.Title className="text-lg font-semibold text-fg">{title}</DialogPrimitive.Title>
              {description ? (
                <DialogPrimitive.Description className="mt-1.5 text-sm leading-relaxed text-fg-muted">
                  {description}
                </DialogPrimitive.Description>
              ) : null}
            </div>
            {children && <div className="mt-5">{children}</div>}
            {footer && <div className="mt-6 flex flex-wrap-reverse justify-end gap-2 sm:flex-nowrap">{footer}</div>}
            {!hideCloseButton && (
              <DialogPrimitive.Close
                className="absolute end-4 top-4 grid size-8 place-items-center rounded-md text-fg-subtle transition-colors hover:bg-ink-50 hover:text-fg"
                aria-label="סגירה"
              >
                <X className="size-5" aria-hidden="true" />
              </DialogPrimitive.Close>
            )}
          </DialogPrimitive.Content>
        </DialogPrimitive.Overlay>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'default' | 'danger';
  /** May return a promise; the dialog stays open and shows the Hebrew error if it rejects. */
  onConfirm: () => void | Promise<void>;
  /** Externally controlled loading state (e.g. a mutation's isPending). */
  loading?: boolean;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  confirmLabel = 'אישור',
  cancelLabel = 'ביטול',
  tone = 'default',
  onConfirm,
  loading,
}: ConfirmDialogProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = loading ?? pending;

  async function handleConfirm() {
    setError(null);
    setPending(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        if (!next) setError(null);
        onOpenChange(next);
      }}
      title={title}
      description={description}
      size="sm"
      footer={
        <>
          <DialogPrimitive.Close asChild>
            <Button variant="secondary" disabled={busy}>
              {cancelLabel}
            </Button>
          </DialogPrimitive.Close>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} loading={busy} onClick={handleConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
      {error && (
        <Callout tone="danger" className={cn(children ? 'mt-4' : undefined)} role="alert">
          {error}
        </Callout>
      )}
    </Dialog>
  );
}

export interface DrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Accessible title (may be visually hidden). */
  title: string;
  hideTitle?: boolean;
  children: ReactNode;
  className?: string;
}

/** Side sheet that slides in from the inline-start edge (right in RTL). */
export function Drawer({ open, onOpenChange, title, hideTitle = false, children, className }: DrawerProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-ink-950/50 animate-fade-in" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className={cn(
            'fixed inset-y-0 start-0 z-50 flex w-[min(20rem,86vw)] flex-col shadow-lg animate-slide-in-start focus:outline-none',
            className,
          )}
        >
          <DialogPrimitive.Title className={cn(hideTitle ? 'sr-only' : 'px-5 pt-5 text-lg font-semibold')}>
            {title}
          </DialogPrimitive.Title>
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export const DialogClose = DialogPrimitive.Close;
