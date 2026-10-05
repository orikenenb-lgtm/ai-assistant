import { readFile } from 'node:fs/promises';
import { extname, join, normalize, relative, isAbsolute } from 'node:path';

/**
 * פרוטוקול app:// להגשת ה-renderer (במקום file://, לפי המלצות האבטחה של Electron):
 * מקור קבוע (app://jarvis), CSP קשיח בכותרות, וחסימת יציאה מתיקיית ה-renderer.
 */

export const APP_SCHEME = 'app';
export const APP_HOST = 'jarvis';
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;

/** CSP לייצור. אין חיבורי רשת מה-renderer — כל קריאה לענן עוברת דרך main. */
export const PRODUCTION_CSP = [
  "default-src 'none'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self' blob: data: mediastream:",
  "connect-src 'self' blob: data:",
  "worker-src 'self' blob:",
  "manifest-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-src 'none'",
  "frame-ancestors 'none'",
].join('; ');

/** CSP לפיתוח מול Vite (צריך inline script ל-React Refresh ו-WebSocket ל-HMR). */
export function developmentCsp(devOrigin: string): string {
  const ws = devOrigin.replace(/^http/, 'ws');
  return [
    "default-src 'none'",
    `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' ${devOrigin}`,
    `style-src 'self' 'unsafe-inline' ${devOrigin}`,
    `img-src 'self' data: blob: ${devOrigin}`,
    `font-src 'self' data: ${devOrigin}`,
    "media-src 'self' blob: data: mediastream:",
    `connect-src 'self' blob: data: ${devOrigin} ${ws}`,
    `worker-src 'self' blob: ${devOrigin}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-src 'none'",
  ].join('; ');
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.onnx': 'application/octet-stream',
  '.pv': 'application/octet-stream',
  '.ppn': 'application/octet-stream',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
};

/** ממפה URL של app:// לקובץ בתוך rootDir. מחזיר null אם הנתיב מנסה לצאת מהתיקייה. */
export function resolveAppPath(rootDir: string, requestUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(requestUrl);
  } catch {
    return null;
  }
  if (url.protocol !== `${APP_SCHEME}:` || url.host !== APP_HOST) return null;
  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  if (pathname.includes('\0')) return null;
  const rel = pathname === '/' || pathname === '' ? 'index.html' : pathname.replace(/^\/+/, '');
  const full = normalize(join(rootDir, rel));
  const back = relative(rootDir, full);
  if (back.startsWith('..') || isAbsolute(back)) return null;
  return full;
}

export async function serveAppRequest(rootDir: string, requestUrl: string): Promise<Response> {
  const file = resolveAppPath(rootDir, requestUrl);
  if (!file) return new Response('Forbidden', { status: 403 });
  try {
    const body = await readFile(file);
    return new Response(new Uint8Array(body), {
      status: 200,
      headers: {
        'Content-Type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
        'Content-Security-Policy': PRODUCTION_CSP,
        'X-Content-Type-Options': 'nosniff',
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Referrer-Policy': 'no-referrer',
        'Cache-Control': 'no-cache',
      },
    });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}
