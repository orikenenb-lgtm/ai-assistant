import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createFileLogger, redact, redactString } from '../../../src/main/app/logger';
import { resolveAppPath, PRODUCTION_CSP } from '../../../src/main/app/protocol';
import { isTrustedOrigin } from '../../../src/main/app/security';
import { INVOKE_CHANNELS, IPC, SEND_CHANNELS } from '../../../src/shared/ipc-channels';
import { IPC_REQUEST_SCHEMAS, IPC_SEND_SCHEMAS, SubmitRequestSchema, TranscribeRequestSchema } from '../../../src/shared/ipc-schemas';

describe('logger redaction', () => {
  it('hides API keys, bearer tokens and Windows user names', () => {
    const s = redactString('key sk-ant-api03-abcdefghijklmnop and Bearer abc.def.ghijklmnop at C:\\Users\\Ori\\Documents\\x.elk');
    expect(s).not.toContain('abcdefghijklmnop');
    expect(s).not.toContain('Ori');
    expect(s).toContain('C:\\Users\\<user>');
  });

  it('drops secret-named fields and free text unless verbose', () => {
    const out = redact({ apiKey: 'whatever', text: 'תפתח את הפרויקט', nested: { authorization: 'x' }, count: 3 }, false) as Record<string, unknown>;
    expect(out.apiKey).toBe('[REDACTED]');
    expect(out.text).toBe('[text:15 chars]');
    expect((out.nested as Record<string, unknown>).authorization).toBe('[REDACTED]');
    expect(out.count).toBe(3);
    const verbose = redact({ text: 'תפתח' }, true) as Record<string, unknown>;
    expect(verbose.text).toBe('תפתח');
  });

  it('writes JSONL lines without secrets and can clear all logs', () => {
    const dir = mkdtempSync(join(tmpdir(), 'jarvis-log-'));
    const logger = createFileLogger({ dir, clock: { now: () => new Date('2026-10-05T10:00:00Z') }, isVerbose: () => false, mirrorToConsole: false });
    logger.info('test.event', { apiKey: 'sk-ant-secret-value-123', n: 1 });
    logger.debug('hidden.debug');
    const files = readdirSync(dir);
    expect(files).toEqual(['jarvis-2026-10-05.log']);
    const content = readFileSync(join(dir, files[0]!), 'utf8');
    expect(content).toContain('test.event');
    expect(content).not.toContain('sk-ant-secret-value-123');
    expect(content).not.toContain('hidden.debug');
    logger.clearAll();
    expect(readdirSync(dir)).toEqual([]);
  });
});

describe('app:// protocol', () => {
  // נתיב מוחלט לפי מערכת ההפעלה הנוכחית (הבדיקה רצה גם ב-Windows ב-CI)
  const root = resolve(tmpdir(), 'jarvis', 'dist', 'renderer');
  it('maps the root to index.html and serves assets inside the renderer folder', () => {
    expect(resolveAppPath(root, 'app://jarvis/')).toBe(join(root, 'index.html'));
    expect(resolveAppPath(root, 'app://jarvis/assets/main.js')).toBe(join(root, 'assets', 'main.js'));
  });
  it('blocks path traversal, other hosts and other schemes', () => {
    // ה-URL מנורמל לפני המיפוי, ולכן ".." לעולם לא יוצא מתיקיית ה-renderer
    for (const evil of ['app://jarvis/../../etc/passwd', 'app://jarvis/%2e%2e/%2e%2e/secrets.json', 'app://jarvis/..%2f..%2fsecrets.json']) {
      const resolved = resolveAppPath(root, evil);
      expect(resolved === null || resolved.startsWith(`${root}${sep}`), evil).toBe(true);
    }
    expect(resolveAppPath(root, 'app://evil/index.html')).toBeNull();
    expect(resolveAppPath(root, 'file:///etc/passwd')).toBeNull();
    expect(resolveAppPath(root, 'app://jarvis/a%00b')).toBeNull();
  });
  it('production CSP forbids remote scripts and remote connections', () => {
    expect(PRODUCTION_CSP).toContain("default-src 'none'");
    expect(PRODUCTION_CSP).toContain("script-src 'self' 'wasm-unsafe-eval'");
    expect(PRODUCTION_CSP).toContain("connect-src 'self' blob: data:");
    expect(PRODUCTION_CSP).not.toMatch(/https?:/);
    expect(PRODUCTION_CSP).not.toMatch(/'unsafe-eval'/);
  });
});

describe('security: trusted origins', () => {
  it('accepts only the app origin and the dev server', () => {
    expect(isTrustedOrigin('app://jarvis/index.html', null)).toBe(true);
    expect(isTrustedOrigin('http://127.0.0.1:5173/', null)).toBe(false);
    expect(isTrustedOrigin('http://127.0.0.1:5173/', 'http://127.0.0.1:5173')).toBe(true);
    expect(isTrustedOrigin('https://evil.example/', 'http://127.0.0.1:5173')).toBe(false);
    expect(isTrustedOrigin('app://jarvis.evil/index.html', null)).toBe(false);
    expect(isTrustedOrigin(undefined, null)).toBe(false);
  });
});

describe('IPC contract', () => {
  it('every invoke channel has a strict request schema', () => {
    for (const channel of INVOKE_CHANNELS) {
      expect(IPC_REQUEST_SCHEMAS, channel).toHaveProperty(channel);
    }
    expect(Object.keys(IPC_REQUEST_SCHEMAS).sort()).toEqual([...INVOKE_CHANNELS].sort());
    expect(Object.keys(IPC_SEND_SCHEMAS).sort()).toEqual([...SEND_CHANNELS].sort());
  });

  it('wake-word audio frames must be small Int16Array chunks', () => {
    const schema = IPC_SEND_SCHEMAS[IPC.wakewordFrames];
    expect(schema.safeParse(new Int16Array(512)).success).toBe(true);
    expect(schema.safeParse(new Int16Array(0)).success).toBe(false);
    expect(schema.safeParse(new Int16Array(5000)).success).toBe(false);
    expect(schema.safeParse(new Float32Array(512)).success).toBe(false);
    expect(schema.safeParse([1, 2, 3]).success).toBe(false);
  });

  it('rejects malformed or oversized payloads', () => {
    expect(SubmitRequestSchema.safeParse({ text: 'שלום', source: 'text', clientRequestId: 'not-a-uuid' }).success).toBe(false);
    expect(SubmitRequestSchema.safeParse({ text: 'x'.repeat(2001), source: 'text', clientRequestId: crypto.randomUUID() }).success).toBe(false);
    expect(SubmitRequestSchema.safeParse({ text: 'שלום', source: 'text', clientRequestId: crypto.randomUUID(), extra: 1 }).success).toBe(false);
    expect(TranscribeRequestSchema.safeParse({ audio: new Uint8Array(10), mimeType: 'audio/wav', durationMs: 1000 }).success).toBe(false);
    expect(TranscribeRequestSchema.safeParse({ audio: new Uint8Array(5 * 1024 * 1024), mimeType: 'audio/wav', durationMs: 1000 }).success).toBe(false);
    expect(IPC_REQUEST_SCHEMAS[IPC.secretsSet].safeParse({ name: 'evilKey', value: 'abcdefghijk' }).success).toBe(false);
  });

  it('battery reports with Infinity (as Chromium sends them) become null instead of being rejected', () => {
    const parsed = IPC_REQUEST_SCHEMAS[IPC.systemReportBattery].safeParse({ level: 1, charging: true, chargingTime: 0, dischargingTime: Infinity });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data).toMatchObject({ dischargingTime: null, chargingTime: 0 });
  });

  it('exposes no channel that could run commands or read files', () => {
    const joined = INVOKE_CHANNELS.join(' ');
    expect(joined).not.toMatch(/exec|shell|spawn|readFile|writeFile|eval|powershell|cmd/i);
  });
});
