import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export type ToastTone = 'info' | 'success' | 'warn' | 'danger';

export interface ToastOptions {
  title: string;
  description?: string;
  tone?: ToastTone;
  /** ms; default 5000 (danger: 8000). 0 = sticky. */
  duration?: number;
}

interface ToastItem extends Required<Pick<ToastOptions, 'title' | 'tone' | 'duration'>> {
  id: number;
  description?: string;
}

interface ToastContextValue {
  toast: (options: ToastOptions) => number;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const TONE_STYLES: Record<ToastTone, { box: string; icon: ReactNode }> = {
  info: { box: 'border-line border-s-harbor-500', icon: <Info className="text-harbor-600" /> },
  success: { box: 'border-line border-s-moss-500', icon: <CircleCheck className="text-moss-600" /> },
  warn: { box: 'border-line border-s-amber-500', icon: <TriangleAlert className="text-amber-600" /> },
  danger: { box: 'border-line border-s-coral-500', icon: <CircleAlert className="text-coral-600" /> },
};

const MAX_VISIBLE = 4;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
  }, []);

  const toast = useCallback(
    (options: ToastOptions) => {
      const id = nextId.current++;
      const tone = options.tone ?? 'info';
      const duration = options.duration ?? (tone === 'danger' ? 8000 : 5000);
      setItems((prev) => [...prev, { id, title: options.title, description: options.description, tone, duration }].slice(-MAX_VISIBLE));
      if (duration > 0) timers.current.set(id, setTimeout(() => dismiss(id), duration));
      return id;
    },
    [dismiss],
  );

  useEffect(() => {
    const map = timers.current;
    return () => {
      for (const t of map.values()) clearTimeout(t);
      map.clear();
    };
  }, []);

  const value = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        aria-relevant="additions"
        className={cn(
          'pointer-events-none fixed inset-x-4 z-[80] flex flex-col gap-2',
          'bottom-[calc(var(--spacing-tabbar)+0.75rem+env(safe-area-inset-bottom))] lg:bottom-6',
          'sm:inset-x-auto sm:end-6 sm:w-96',
        )}
      >
        {items.map((t) => (
          <div
            key={t.id}
            role={t.tone === 'danger' ? 'alert' : 'status'}
            className={cn(
              'pointer-events-auto flex items-start gap-3 rounded-xl border border-s-4 bg-surface p-4 shadow-lg animate-toast-in',
              TONE_STYLES[t.tone].box,
            )}
          >
            <span className="mt-0.5 shrink-0 [&_svg]:size-5" aria-hidden="true">
              {TONE_STYLES[t.tone].icon}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-fg">{t.title}</p>
              {t.description && <p className="mt-0.5 text-sm leading-relaxed text-fg-muted">{t.description}</p>}
            </div>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              className="touch-target -m-1 grid size-8 shrink-0 place-items-center rounded-md text-fg-subtle hover:bg-surface-hover hover:text-fg"
              aria-label="סגירת ההודעה"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/** `const { toast } = useToast(); toast({ title: 'נשמר', tone: 'success' })` */
export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within <ToastProvider>');
  return ctx;
}
