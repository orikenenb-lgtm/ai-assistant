/**
 * צילום מסך לניתוח — בזיכרון בלבד, אף פעם לא לדיסק.
 *
 * listDisplays: גאומטריה בלבד (בלי צילום מקדים) — משמש את חלון האישור לבחירת מסך.
 * capture: מצלם מסך אחד ברזולוציה הפיזית שלו, מקטין כך שהצלע הארוכה <= maxLongEdgePx,
 * ומקודד PNG (טקסט קטן בעברית נשאר חד). אם ה-PNG גדול מ-3.5MB — JPEG באיכות 85.
 *
 * רק טיפוסים מיובאים מ-electron: המודולים האמיתיים (desktopCapturer, screen) מוזרקים מ-main.ts.
 */
import type { DesktopCapturer, DesktopCapturerSource, Display, NativeImage, Screen } from 'electron';
import type { DisplayInfo } from '../../shared/types';
import { ProviderError, type CapturedImage, type Logger, type ScreenCaptureService } from '../core/contracts';

export interface ScreenCaptureDeps {
  desktopCapturer: Pick<DesktopCapturer, 'getSources'>;
  screen: Pick<Screen, 'getAllDisplays' | 'getPrimaryDisplay'>;
  logger: Logger;
}

/** מעל הגודל הזה PNG מוחלף ב-JPEG (מגבלת 5MB לתמונה ב-API, אחרי base64). */
export const MAX_PNG_BYTES = 3.5 * 1024 * 1024;
/** הצלע הארוכה המקסימלית שנשלחת (רזולוציה גבוהה של Claude). */
export const MAX_LONG_EDGE_CAP = 2576;
const MIN_LONG_EDGE = 320;
const JPEG_QUALITIES = [85, 70, 55] as const;
/** סטייה מותרת ביחס הרוחב/גובה כשמזהים מסך לפי סדר (גיבוי). */
const ASPECT_TOLERANCE = 0.03;

/** גודל פיזי בפיקסלים = גודל לוגי (DIP) × קנה מידה. */
export function physicalSize(display: Pick<Display, 'size' | 'scaleFactor'>): { width: number; height: number } {
  const scale = Number.isFinite(display.scaleFactor) && display.scaleFactor > 0 ? display.scaleFactor : 1;
  return {
    width: Math.max(1, Math.round(display.size.width * scale)),
    height: Math.max(1, Math.round(display.size.height * scale)),
  };
}

/** מידות אחרי הקטנה כך שהצלע הארוכה <= maxLongEdge (שומר יחס). לא מגדיל תמונה קטנה. */
export function fitWithinLongEdge(width: number, height: number, maxLongEdge: number): { width: number; height: number } {
  const longEdge = Math.max(width, height);
  if (longEdge <= maxLongEdge) return { width, height };
  const scale = maxLongEdge / longEdge;
  if (width >= height) {
    return { width: maxLongEdge, height: Math.min(maxLongEdge, Math.max(1, Math.round(height * scale))) };
  }
  return { width: Math.min(maxLongEdge, Math.max(1, Math.round(width * scale))), height: maxLongEdge };
}

function clampLongEdge(value: number): number {
  if (!Number.isFinite(value)) return 1920;
  return Math.min(MAX_LONG_EDGE_CAP, Math.max(MIN_LONG_EDGE, Math.floor(value)));
}

function displayLabel(index: number, primary: boolean, width: number, height: number): string {
  return `מסך ${index + 1}${primary ? ' (ראשי)' : ''} — ${width}×${height}`;
}

export function createScreenCaptureService(deps: ScreenCaptureDeps): ScreenCaptureService {
  const { logger } = deps;

  function readDisplays(): Array<{ info: DisplayInfo; display: Display }> {
    const all = deps.screen.getAllDisplays();
    let primaryId: string | null = null;
    try {
      primaryId = String(deps.screen.getPrimaryDisplay().id);
    } catch {
      primaryId = null;
    }
    return all.map((display, index) => {
      const { width, height } = physicalSize(display);
      const id = String(display.id);
      const primary = id === primaryId;
      return {
        display,
        info: {
          id,
          label: displayLabel(index, primary, width, height),
          width,
          height,
          scaleFactor: display.scaleFactor,
          primary,
        },
      };
    });
  }

  function listDisplays(): DisplayInfo[] {
    return readDisplays().map((d) => d.info);
  }

  function aspectMatches(img: { width: number; height: number }, info: DisplayInfo): boolean {
    if (img.width <= 0 || img.height <= 0) return false;
    const a = img.width / img.height;
    const b = info.width / info.height;
    return Math.abs(a - b) / b <= ASPECT_TOLERANCE;
  }

  /** בוחר את המקור של המסך שאושר. גיבוי לפי סדר — רק כשאין שום התאמה לפי מזהה ומספר המקורות זהה. */
  function pickSource(
    sources: DesktopCapturerSource[],
    displays: Array<{ info: DisplayInfo }>,
    target: DisplayInfo,
  ): { source: DesktopCapturerSource; byIndex: boolean } {
    const exact = sources.find((s) => s.display_id === target.id);
    if (exact) return { source: exact, byIndex: false };
    const index = displays.findIndex((d) => d.info.id === target.id);
    const anyIdMatches = sources.some((s) => s.display_id && displays.some((d) => d.info.id === s.display_id));
    const fallback = sources[index];
    if (!anyIdMatches && sources.length === displays.length && fallback) {
      logger.warn('screen.source_matched_by_index', { index, sources: sources.length });
      return { source: fallback, byIndex: true };
    }
    throw new ProviderError(
      'CAPTURE_FAILED',
      'לא הצלחתי לזהות את המסך שנבחר בין מקורות הצילום, ולכן לא צילמתי. נסה שוב או בחר מסך אחר.',
      true,
    );
  }

  function encode(img: NativeImage): { data: Buffer; mediaType: CapturedImage['mediaType'] } {
    const png = img.toPNG();
    if (png.length > 0 && png.length <= MAX_PNG_BYTES) return { data: png, mediaType: 'image/png' };
    // PNG גדול מדי — מחליפים ל-JPEG, ומאפסים את העותק שלא נשלח
    png.fill(0);
    for (const quality of JPEG_QUALITIES) {
      const jpeg = img.toJPEG(quality);
      if (jpeg.length > 0 && jpeg.length <= MAX_PNG_BYTES) {
        if (quality !== JPEG_QUALITIES[0]) logger.info('screen.jpeg_quality_reduced', { quality });
        return { data: jpeg, mediaType: 'image/jpeg' };
      }
      jpeg.fill(0);
    }
    throw new ProviderError('CAPTURE_FAILED', 'צילום המסך גדול מדי לשליחה גם אחרי דחיסה.', false);
  }

  async function capture(displayId: string, maxLongEdgePx: number): Promise<CapturedImage> {
    let displays: Array<{ info: DisplayInfo; display: Display }>;
    try {
      displays = readDisplays();
    } catch (err) {
      throw new ProviderError('CAPTURE_FAILED', 'לא הצלחתי לקרוא את רשימת המסכים.', true, { cause: err });
    }
    const target = displays.find((d) => d.info.id === displayId)?.info;
    if (!target) {
      throw new ProviderError('CAPTURE_FAILED', 'המסך שנבחר לא נמצא (אולי נותק). בחר מסך אחר ונסה שוב.', false);
    }

    let sources: DesktopCapturerSource[];
    try {
      sources = await deps.desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: target.width, height: target.height },
        fetchWindowIcons: false,
      });
    } catch (err) {
      logger.warn('screen.get_sources_failed', { error: err instanceof Error ? err.message : String(err) });
      throw new ProviderError(
        'CAPTURE_FAILED',
        'Windows לא איפשר לצלם את המסך. ודא שאין חסימה של צילום מסך ונסה שוב.',
        true,
        { cause: err },
      );
    }

    const { source, byIndex } = pickSource(sources, displays, target);
    const thumbnail = source.thumbnail;
    if (!thumbnail || thumbnail.isEmpty()) {
      throw new ProviderError(
        'CAPTURE_FAILED',
        'הצילום חזר ריק — ייתכן שהמסך כבוי או נעול, או שאין הרשאה לצלם אותו. נסה שוב.',
        true,
      );
    }
    const size = thumbnail.getSize();
    if (!(size.width > 0 && size.height > 0)) {
      throw new ProviderError('CAPTURE_FAILED', 'הצילום חזר ריק. נסה שוב.', true);
    }
    // בגיבוי לפי סדר — מוודאים שהצורה תואמת למסך שאושר, כדי לא לשלוח בטעות מסך אחר
    if (byIndex && !aspectMatches(size, target)) {
      throw new ProviderError(
        'CAPTURE_FAILED',
        'לא הצלחתי לוודא שהצילום הוא של המסך שבחרת, ולכן לא שלחתי אותו. נסה שוב.',
        true,
      );
    }

    const fit = fitWithinLongEdge(size.width, size.height, clampLongEdge(maxLongEdgePx));
    const img = fit.width === size.width && fit.height === size.height
      ? thumbnail
      : thumbnail.resize({ width: fit.width, height: fit.height, quality: 'good' });
    if (img.isEmpty()) throw new ProviderError('CAPTURE_FAILED', 'הקטנת הצילום נכשלה. נסה שוב.', true);
    const finalSize = img.getSize();
    const { data, mediaType } = encode(img);

    logger.info('screen.captured', {
      width: finalSize.width,
      height: finalSize.height,
      bytes: data.length,
      mediaType,
      byIndex,
    });
    return { data, mediaType, width: finalSize.width, height: finalSize.height, display: target };
  }

  return { listDisplays, capture };
}
