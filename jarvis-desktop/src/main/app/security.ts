import type { App, IpcMainInvokeEvent, Session, WebContents } from 'electron';
import type { Logger } from '../core/contracts';
import { APP_ORIGIN } from './protocol';

/**
 * שכבת ההקשחה של Electron:
 * - ניווט/חלונות חדשים חסומים.
 * - הרשאות: רק מיקרופון (אודיו בלבד) למקור של האפליקציה. כל השאר נדחה.
 * - getDisplayMedia חסום ב-renderer — צילום מסך קורה רק ב-main, אחרי אישור.
 * - כל IPC מאומת לפי המקור של ה-frame השולח.
 */

export function isTrustedOrigin(url: string | undefined, devOrigin: string | null): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    if (u.origin === APP_ORIGIN || `${u.protocol}//${u.host}` === APP_ORIGIN) return true;
    if (devOrigin && u.origin === devOrigin) return true;
    return false;
  } catch {
    return false;
  }
}

export function isTrustedSender(event: IpcMainInvokeEvent, devOrigin: string | null, expected: () => WebContents | null): boolean {
  const target = expected();
  if (!target || event.sender.id !== target.id) return false;
  const frame = event.senderFrame;
  if (!frame || frame.parent !== null) return false; // רק ה-frame הראשי
  return isTrustedOrigin(frame.url, devOrigin);
}

export function hardenSession(ses: Session, devOrigin: string | null, logger: Logger): void {
  ses.setPermissionRequestHandler((_wc, permission, callback, details) => {
    const requestingUrl = 'requestingUrl' in details ? details.requestingUrl : undefined;
    const trusted = isTrustedOrigin(requestingUrl, devOrigin);
    if (permission === 'media') {
      const types = 'mediaTypes' in details ? (details.mediaTypes ?? []) : [];
      const audioOnly = types.length > 0 && types.every((t) => t === 'audio');
      const allow = trusted && audioOnly;
      if (!allow) logger.warn('security.media_permission_denied', { types, trusted });
      callback(allow);
      return;
    }
    logger.warn('security.permission_denied', { permission });
    callback(false);
  });

  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin) => {
    return permission === 'media' && isTrustedOrigin(requestingOrigin, devOrigin);
  });

  // אין שיתוף מסך מה-renderer
  ses.setDisplayMediaRequestHandler((_request, callback) => {
    logger.warn('security.display_media_denied');
    callback({});
  });

  ses.setDevicePermissionHandler(() => false);
}

export function hardenWebContentsCreation(app: App, devOrigin: string | null, logger: Logger): void {
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-navigate', (event, url) => {
      if (!isTrustedOrigin(url, devOrigin)) {
        event.preventDefault();
        logger.warn('security.navigation_blocked');
      }
    });
    contents.on('will-redirect', (event, url) => {
      if (!isTrustedOrigin(url, devOrigin)) event.preventDefault();
    });
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-attach-webview', (event) => event.preventDefault());
  });
}
