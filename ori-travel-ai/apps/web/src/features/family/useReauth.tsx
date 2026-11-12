import { useRef, useState, type ReactNode } from 'react';
import { reauth } from '@/features/travelers/api';
import { ApiError, isApiError } from '@/lib/api';
import { ReauthDialog } from './components/ReauthDialog';

/**
 * Runs a sensitive action; on 403 REAUTH_REQUIRED opens the password dialog,
 * calls POST /api/auth/reauth and retries the action once. Render `dialog` somewhere in the tree.
 */
export function useReauth(): { withReauth: <T>(action: () => Promise<T>) => Promise<T>; dialog: ReactNode } {
  const [open, setOpen] = useState(false);
  const pending = useRef<{ retry: (password: string) => Promise<void>; cancel: () => void } | null>(null);

  function withReauth<T>(action: () => Promise<T>): Promise<T> {
    return action().catch((e: unknown) => {
      if (!(isApiError(e) && e.status === 403 && e.code === 'REAUTH_REQUIRED')) throw e;
      return new Promise<T>((resolve, reject) => {
        pending.current = {
          retry: async (password) => {
            await reauth(password);
            try {
              resolve(await action());
            } catch (err) {
              reject(err);
            }
          },
          cancel: () => reject(new ApiError({ status: 403, code: 'REAUTH_CANCELLED', message: 'האימות בוטל' })),
        };
        setOpen(true);
      });
    });
  }

  const dialog = (
    <ReauthDialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o && pending.current) {
          const p = pending.current;
          pending.current = null;
          // If it was confirmed, retry() already settled the promise; cancel() is then a harmless no-op.
          p.cancel();
        }
      }}
      onConfirm={async (password) => {
        const p = pending.current;
        if (p) await p.retry(password);
      }}
      description="הפעולה רגישה ודורשת אימות סיסמה מחדש. האימות תקף ל-10 דקות."
      confirmLabel="אימות והמשך"
    />
  );
  return { withReauth, dialog };
}
