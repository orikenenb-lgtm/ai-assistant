import { Button, ErrorState, Spinner } from '@/components/ui';
import { LogoMark } from './Logo';

export interface FullPageStatusProps {
  kind: 'loading' | 'error';
  error?: unknown;
  onRetry?: () => void;
  title?: string;
  message?: string;
}

/** Whole-screen loading / error (before the app shell can render). */
export function FullPageStatus({ kind, error, onRetry, title, message }: FullPageStatusProps) {
  return (
    <div className="grid min-h-dvh place-items-center bg-canvas px-4">
      {kind === 'loading' ? (
        <div className="flex flex-col items-center gap-4 text-fg-muted">
          <LogoMark className="size-12" />
          <Spinner label="טוען את Ori Travel AI…" />
        </div>
      ) : (
        <div className="w-full max-w-md">
          <ErrorState error={error} title={title} message={message} onRetry={onRetry} />
          {!onRetry && (
            <div className="mt-4 text-center">
              <Button variant="secondary" onClick={() => window.location.reload()}>
                רענון הדף
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
