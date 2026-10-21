import { expect, test } from '@playwright/test';
import { launchJarvis } from './helpers';

/**
 * בדיקות קבלה: מניעת גישה ישירה מה-renderer לפקודות מערכת.
 * רצות על האפליקציה האמיתית (Electron), בלי mocks.
 */

test('renderer has no Node.js, no require, no ipcRenderer — only the frozen window.jarvis API', async () => {
  const { app, page } = await launchJarvis();
  try {
    const probe = await page.evaluate(() => {
      const w = window as unknown as Record<string, unknown>;
      return {
        require: typeof w.require,
        process: typeof w.process,
        module: typeof w.module,
        Buffer: typeof w.Buffer,
        electron: typeof w.electron,
        ipcRenderer: typeof w.ipcRenderer,
        jarvisKeys: Object.keys(window.jarvis).sort(),
        frozen: Object.isFrozen(window.jarvis),
      };
    });
    expect(probe.require).toBe('undefined');
    expect(probe.process).toBe('undefined');
    expect(probe.module).toBe('undefined');
    expect(probe.Buffer).toBe('undefined');
    expect(probe.electron).toBe('undefined');
    expect(probe.ipcRenderer).toBe('undefined');
    expect(probe.jarvisKeys).toEqual(
      ['assistant', 'data', 'onCommand', 'platform', 'secrets', 'settings', 'system', 'version', 'voice', 'wakeword', 'window'].sort(),
    );
    expect(probe.frozen).toBe(true);
  } finally {
    await app.close();
  }
});

test('CSP blocks injected inline scripts and remote network access from the renderer', async () => {
  const { app, page } = await launchJarvis();
  try {
    // הערה: evaluate של Playwright רץ דרך DevTools ועוקף CSP, לכן בודקים הזרקת <script> אמיתית
    const result = await page.evaluate(async () => {
      const violations: string[] = [];
      document.addEventListener('securitypolicyviolation', (e) => violations.push(e.violatedDirective));
      const s = document.createElement('script');
      s.textContent = 'window.__inlineRan = true';
      document.body.appendChild(s);
      const img = document.createElement('img');
      img.src = 'https://example.com/pixel.png';
      document.body.appendChild(img);
      let fetchBlocked = false;
      try {
        await fetch('https://example.com/');
      } catch {
        fetchBlocked = true;
      }
      await new Promise((r) => setTimeout(r, 300));
      return { inlineRan: (window as unknown as { __inlineRan?: boolean }).__inlineRan === true, fetchBlocked, violations };
    });
    expect(result.inlineRan).toBe(false);
    expect(result.fetchBlocked).toBe(true);
    expect(result.violations.join(' ')).toMatch(/script-src/);
    expect(result.violations.join(' ')).toMatch(/connect-src|img-src/);
  } finally {
    await app.close();
  }
});

test('invalid IPC payloads are rejected by main (zod) and secrets are write-only', async () => {
  const { app, page } = await launchJarvis();
  try {
    const result = await page.evaluate(async () => {
      const api = window.jarvis as unknown as Record<string, Record<string, (...a: unknown[]) => Promise<unknown>>>;
      const outcomes: Record<string, string> = {};
      try {
        await api.assistant!.submit!({ text: 'x', source: 'text', clientRequestId: 'not-a-uuid' });
        outcomes.badSubmit = 'accepted';
      } catch {
        outcomes.badSubmit = 'rejected';
      }
      try {
        await api.data!.listTasks!('everything');
        outcomes.badFilter = 'accepted';
      } catch {
        outcomes.badFilter = 'rejected';
      }
      const status = (await window.jarvis.secrets.status()) as unknown as { entries: Array<Record<string, unknown>> };
      outcomes.secretFields = Object.keys(status.entries[0] ?? {}).sort().join(',');
      return outcomes;
    });
    expect(result.badSubmit).toBe('rejected');
    expect(result.badFilter).toBe('rejected');
    // רק סטטוס — אין שדה value
    expect(result.secretFields).toBe('configured,name,source');
  } finally {
    await app.close();
  }
});

test('navigation away from the app and new windows are blocked', async () => {
  const { app, page } = await launchJarvis();
  try {
    const before = page.url();
    await page.evaluate(() => {
      window.location.href = 'https://example.com/';
    });
    await page.waitForTimeout(1000);
    expect(page.url()).toBe(before);
    const opened = await page.evaluate(() => window.open('https://example.com/') === null);
    expect(opened).toBe(true);
    expect(app.windows().length).toBe(1);
  } finally {
    await app.close();
  }
});
