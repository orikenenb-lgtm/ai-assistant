import { isRouteErrorResponse, useRouteError } from 'react-router';
import { FullPageStatus } from './FullPageStatus';

function isChunkLoadError(error: unknown): boolean {
  return error instanceof Error && /dynamically imported module|Importing a module script failed|Failed to fetch/i.test(error.message);
}

/** Router errorElement: Hebrew message instead of a blank screen. */
export function RouteErrorBoundary() {
  const error = useRouteError();
  if (isChunkLoadError(error)) {
    return (
      <FullPageStatus
        kind="error"
        title="גרסה חדשה של האפליקציה זמינה"
        message="לא ניתן היה לטעון חלק מהמסך. רעננו את הדף כדי לטעון את הגרסה העדכנית."
      />
    );
  }
  if (isRouteErrorResponse(error)) {
    return <FullPageStatus kind="error" title={`שגיאה ${error.status}`} message="הדף שביקשתם אינו זמין." />;
  }
  if (import.meta.env.DEV) console.error(error);
  return <FullPageStatus kind="error" title="משהו השתבש" message="אירעה שגיאה בלתי צפויה בתצוגה. נסו לרענן את הדף." />;
}
