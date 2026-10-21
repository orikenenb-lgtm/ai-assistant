import { Notification } from 'electron';
import type { Logger } from '../core/contracts';

/**
 * התראות מערכת (Toast ב-Windows) לתזכורות.
 * הייבוא של electron מבודד בקובץ הזה בלבד — המתזמן מקבל Notifier מוזרק ונבדק בלי Electron.
 */

export interface NotificationRequest {
  title: string;
  body: string;
  silent?: boolean;
}

export interface Notifier {
  show(n: NotificationRequest): void;
}

export interface ElectronNotifierDeps {
  /** לחיצה על ההתראה — בדרך כלל מציגה את חלון JARVIS. */
  onClick: () => void;
  logger: Logger;
  /** אייקון אופציונלי (נתיב לקובץ). */
  icon?: string;
}

/**
 * כמה התראות מחזיקים בזיכרון במקביל. חייבים להחזיק הפניה לאובייקט עד שההתראה נסגרת —
 * אחרת ה-GC אוסף אותו ואירוע click אובד (בעיה מוכרת ב-Windows). התקרה מונעת דליפה
 * כשאירוע close לא מגיע (למשל התראה שעברה למרכז הפעולות).
 */
const MAX_RETAINED = 25;

export function createElectronNotifier(deps: ElectronNotifierDeps): Notifier {
  const { logger } = deps;
  const retained = new Set<Notification>();
  let warnedUnsupported = false;

  const release = (n: Notification): void => {
    retained.delete(n);
  };

  return {
    show(request) {
      try {
        if (!Notification.isSupported()) {
          if (!warnedUnsupported) {
            warnedUnsupported = true;
            logger.warn('notifier.unsupported', {});
          }
          return;
        }
        const notification = new Notification({
          title: request.title,
          body: request.body,
          silent: request.silent ?? false,
          ...(deps.icon ? { icon: deps.icon } : {}),
        });
        retained.add(notification);
        while (retained.size > MAX_RETAINED) {
          const oldest = retained.values().next().value;
          if (!oldest) break;
          retained.delete(oldest);
        }
        notification.on('click', () => {
          release(notification);
          try {
            deps.onClick();
          } catch (err) {
            logger.warn('notifier.click_handler_failed', { error: err instanceof Error ? err.message : String(err) });
          }
        });
        notification.on('close', () => release(notification));
        notification.on('failed', (_event, error) => {
          release(notification);
          logger.warn('notifier.failed', { error });
        });
        notification.show();
      } catch (err) {
        // כשל בהצגת Toast לא מפיל את המתזמן; האירוע עדיין נשלח לממשק
        logger.error('notifier.show_failed', { error: err instanceof Error ? err.message : String(err) });
      }
    },
  };
}
