import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * עזרי E2E: מריצים את JARVIS האמיתי (dist/ אחרי build) עם תיקיית נתונים זמנית.
 *
 * ⚠ MOCK: כשבדיקה צריכה "ענן" (Claude / תמלול / הקראה) — מחליפים את fetch בתהליך main
 * בתסריט קבוע (installMockFetch). זה בודק את כל השרשרת המקומית (SDK, מנוע, כלים, IPC, UI),
 * אבל לא מוכיח שהשירות החי עובד. בדיקות כאלה מסומנות "(mock)" בשם.
 */

export const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const isWindows = process.platform === 'win32';

export interface LaunchOptions {
  userDataDir?: string;
  fakeMicWav?: string;
  extraEnv?: Record<string, string>;
}

export interface Launched {
  app: ElectronApplication;
  page: Page;
  userDataDir: string;
}

export function newUserDataDir(): string {
  return mkdtempSync(join(tmpdir(), 'jarvis-e2e-'));
}

export async function launchJarvis(options: LaunchOptions = {}): Promise<Launched> {
  const userDataDir = options.userDataDir ?? newUserDataDir();
  const args: string[] = [];
  // ב-Linux CI (Ubuntu 24.04) AppArmor חוסם את ה-sandbox של Chromium. הבידוד של ה-renderer
  // (contextIsolation + sandbox: true ברמת Electron, בלי Node) נשאר בתוקף ונבדק בנפרד.
  if (process.platform === 'linux') args.push('--no-sandbox');
  if (options.fakeMicWav) {
    args.push('--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${options.fakeMicWav}%noloop`);
  }
  args.push(projectRoot);
  const app = await electron.launch({
    args,
    cwd: projectRoot,
    env: {
      ...process.env,
      JARVIS_USER_DATA_DIR: userDataDir,
      // אסור שמפתחות אמיתיים מהסביבה ידלפו לבדיקות
      ANTHROPIC_API_KEY: '',
      OPENAI_API_KEY: '',
      AZURE_SPEECH_KEY: '',
      PICOVOICE_ACCESS_KEY: '',
      ...options.extraEnv,
    },
    timeout: 45_000,
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => typeof window.jarvis === 'object', undefined, { timeout: 20_000 });
  return { app, page, userDataDir };
}

export interface MockRoute {
  /** תת-מחרוזת של ה-URL. */
  match: string;
  /** תשובות לפי הסדר. האחרונה חוזרת על עצמה אם נגמרו. */
  responses: Array<{ status?: number; json?: unknown; bodyBase64?: string; contentType?: string; networkError?: boolean; delayMs?: number }>;
}

/**
 * ⚠ MOCK: מחליף את fetch הגלובלי בתהליך main בתסריט. כל בקשה נרשמת ב-globalThis.__jarvisMockCalls.
 * בקשות שלא תואמות אף נתיב נכשלות כשגיאת רשת — כדי ששום דבר לא יגיע לאינטרנט בטעות.
 */
export async function installMockFetch(app: ElectronApplication, routes: MockRoute[]): Promise<void> {
  await app.evaluate(async (_electron, routesArg: MockRoute[]) => {
    const g = globalThis as unknown as {
      __jarvisMockCalls: Array<{ url: string; method: string; body: unknown }>;
      __jarvisOriginalFetch?: typeof fetch;
      fetch: typeof fetch;
    };
    g.__jarvisMockCalls = [];
    g.__jarvisOriginalFetch ??= g.fetch;
    const queues = routesArg.map((r) => ({ match: r.match, responses: [...r.responses] }));
    g.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const method = init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET');
      let body: unknown = null;
      const rawBody = init?.body ?? (typeof input === 'object' && 'body' in input ? (input as Request).body : null);
      if (typeof rawBody === 'string') {
        try {
          body = JSON.parse(rawBody);
        } catch {
          body = rawBody.slice(0, 2000);
        }
      } else if (rawBody instanceof FormData) {
        const fields: Record<string, unknown> = {};
        rawBody.forEach((v, k) => {
          fields[k] = typeof v === 'string' ? v : `[blob ${(v as Blob).size}]`;
        });
        body = fields;
      } else if (input instanceof Request) {
        try {
          const text = await input.clone().text();
          body = JSON.parse(text);
        } catch {
          body = '[unreadable]';
        }
      }
      g.__jarvisMockCalls.push({ url, method, body });
      const q = queues.find((r) => url.includes(r.match));
      if (!q) throw new TypeError(`mock: no route for ${url}`);
      const next = q.responses.length > 1 ? q.responses.shift()! : q.responses[0]!;
      if (next.delayMs) await new Promise((r) => setTimeout(r, next.delayMs));
      if (next.networkError) throw new TypeError('fetch failed (mock network error)');
      if (next.bodyBase64 !== undefined) {
        return new Response(Buffer.from(next.bodyBase64, 'base64'), {
          status: next.status ?? 200,
          headers: { 'content-type': next.contentType ?? 'application/octet-stream' },
        });
      }
      return new Response(JSON.stringify(next.json ?? {}), {
        status: next.status ?? 200,
        headers: { 'content-type': 'application/json', 'request-id': 'req_mock' },
      });
    }) as typeof fetch;
  }, routes);
}

export async function mockCalls(app: ElectronApplication): Promise<Array<{ url: string; method: string; body: unknown }>> {
  return app.evaluate(() => (globalThis as unknown as { __jarvisMockCalls?: Array<{ url: string; method: string; body: unknown }> }).__jarvisMockCalls ?? []);
}

/** תשובת Messages API מדומה (MOCK) בפורמט האמיתי. */
export function mockClaudeMessage(content: unknown[], stopReason: 'end_turn' | 'tool_use' | 'refusal' = 'end_turn'): unknown {
  return {
    id: `msg_mock_${Math.random().toString(36).slice(2, 10)}`,
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5-5',
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: 120, output_tokens: 40, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  };
}

export function fixture(...parts: string[]): string {
  return join(projectRoot, 'tests', 'fixtures', ...parts);
}

export function fixtureBase64(...parts: string[]): string {
  return readFileSync(fixture(...parts)).toString('base64');
}

/**
 * מדמה את תשובת המשתמש בדיאלוג הנייטיבי של main (dialog.showMessageBox) ורושם את ההודעות.
 * response 0 = "אשר", 1 = "בטל". ה-renderer עצמו לא יכול ללחוץ על הדיאלוג הזה.
 */
export async function answerNativeDialogs(app: ElectronApplication, response: 0 | 1): Promise<void> {
  await app.evaluate(({ dialog }, resp) => {
    const g = globalThis as unknown as { __dialogCalls: string[] };
    g.__dialogCalls = [];
    const fake = async (...args: unknown[]) => {
      const opts = (args.length > 1 ? args[1] : args[0]) as { message?: string; detail?: string };
      g.__dialogCalls.push(`${opts.message ?? ''}\n${opts.detail ?? ''}`);
      return { response: resp, checkboxChecked: false };
    };
    (dialog as unknown as { showMessageBox: typeof fake }).showMessageBox = fake;
  }, response);
}

export async function nativeDialogCalls(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(() => (globalThis as unknown as { __dialogCalls?: string[] }).__dialogCalls ?? []);
}
