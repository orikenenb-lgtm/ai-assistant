import { useEffect } from 'react';

export const APP_NAME = 'Ori Travel AI';

/** Sets `document.title` to "<title> · Ori Travel AI" while mounted. */
export function useDocumentTitle(title: string | null | undefined): void {
  useEffect(() => {
    if (!title) return;
    const previous = document.title;
    document.title = `${title} · ${APP_NAME}`;
    return () => {
      document.title = previous;
    };
  }, [title]);
}
