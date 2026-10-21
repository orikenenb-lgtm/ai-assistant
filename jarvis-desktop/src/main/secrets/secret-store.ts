import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Logger, SecretService } from '../core/contracts';
import {
  SECRET_ENV_VARS,
  SECRET_NAMES,
  type SecretName,
  type SecretsStatus,
  type SecretStatusEntry,
} from '../../shared/settings-schema';

/**
 * מפתחות API:
 * - נשמרים מוצפנים בקובץ secrets.json דרך Electron safeStorage (ב-Windows: DPAPI, קשור למשתמש ה-Windows).
 *   משתמשים ב-API האסינכרוני (המומלץ מ-Electron 44; הסינכרוני יוסר בגרסאות הבאות).
 * - אחרי פענוח בהפעלה הערכים מוחזקים בזיכרון של main בלבד, כדי שספקי AI יקבלו אותם בלי המתנה.
 * - אם הצפנה לא זמינה — הערך נשמר בזיכרון לסשן הנוכחי בלבד (לא בדיסק), והממשק מציג זאת.
 * - משתני סביבה (ANTHROPIC_API_KEY וכו') משמשים גיבוי לפיתוח.
 * - הערך לעולם לא מוחזר ל-renderer ולא נרשם בלוג.
 */

export interface SafeStorageLike {
  isAsyncEncryptionAvailable(): Promise<boolean>;
  encryptStringAsync(plainText: string): Promise<Buffer>;
  decryptStringAsync(encrypted: Buffer): Promise<{ shouldReEncrypt: boolean; result: string }>;
}

interface SecretsFile {
  version: 1;
  entries: Partial<Record<SecretName, string>>;
}

export interface SecretStoreOptions {
  file: string;
  safeStorage: SafeStorageLike;
  logger: Logger;
  env?: NodeJS.ProcessEnv;
}

export interface SecretStore extends SecretService {
  /** מפענח את הקובץ לזיכרון. חובה לקרוא אחרי app 'ready' ולפני שימוש. */
  init(): Promise<void>;
  /** ממתין לסיום כתיבות מוצפנות שבתהליך (לשימוש ב-IPC ובבדיקות). */
  flush(): Promise<void>;
}

export function createSecretStore(options: SecretStoreOptions): SecretStore {
  const { file, safeStorage, logger } = options;
  const env = options.env ?? {};
  /** ערכים מפוענחים שמקורם בקובץ המוצפן. */
  const secure = new Map<SecretName, string>();
  /** ערכים לסשן בלבד (כשאין הצפנה). */
  const session = new Map<SecretName, string>();
  let blobs: Partial<Record<SecretName, string>> = {};
  let encryptionAvailable = false;
  let pending: Promise<void> = Promise.resolve();

  function readFile(): Partial<Record<SecretName, string>> {
    if (!existsSync(file)) return {};
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as SecretsFile;
      if (parsed?.version !== 1 || typeof parsed.entries !== 'object' || parsed.entries === null) return {};
      const out: Partial<Record<SecretName, string>> = {};
      for (const name of SECRET_NAMES) {
        const v = parsed.entries[name];
        if (typeof v === 'string' && v.length > 0) out[name] = v;
      }
      return out;
    } catch (err) {
      logger.warn('secrets.file_unreadable', { error: err instanceof Error ? err.message : String(err) });
      return {};
    }
  }

  function writeFile(): void {
    mkdirSync(dirname(file), { recursive: true });
    const data: SecretsFile = { version: 1, entries: blobs };
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(data), { encoding: 'utf8', mode: 0o600 });
    renameSync(tmp, file);
  }

  function fromEnv(name: SecretName): string | null {
    const v = env[SECRET_ENV_VARS[name]];
    return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
  }

  function entry(name: SecretName): SecretStatusEntry {
    if (secure.has(name)) return { name, configured: true, source: 'secure-store' };
    if (session.has(name)) return { name, configured: true, source: 'session' };
    if (fromEnv(name)) return { name, configured: true, source: 'env' };
    return { name, configured: false, source: 'none' };
  }

  async function encryptAndStore(name: SecretName, value: string): Promise<void> {
    const encrypted = await safeStorage.encryptStringAsync(value);
    blobs = { ...blobs, [name]: encrypted.toString('base64') };
    writeFile();
  }

  return {
    async init() {
      try {
        encryptionAvailable = await safeStorage.isAsyncEncryptionAvailable();
      } catch {
        encryptionAvailable = false;
      }
      blobs = readFile();
      if (!encryptionAvailable) {
        if (Object.keys(blobs).length) logger.warn('secrets.encryption_unavailable_cannot_decrypt');
        return;
      }
      for (const name of SECRET_NAMES) {
        const blob = blobs[name];
        if (!blob) continue;
        try {
          const { result, shouldReEncrypt } = await safeStorage.decryptStringAsync(Buffer.from(blob, 'base64'));
          secure.set(name, result);
          if (shouldReEncrypt) await encryptAndStore(name, result);
        } catch {
          logger.warn('secrets.decrypt_failed', { name });
        }
      }
    },
    flush: () => pending,
    get(name) {
      return secure.get(name) ?? session.get(name) ?? fromEnv(name);
    },
    set(name, value) {
      const clean = value.trim();
      if (clean.length < 8 || /\s/.test(clean)) throw new Error('ערך המפתח לא תקין.');
      if (encryptionAvailable) {
        secure.set(name, clean);
        session.delete(name);
        pending = pending
          .then(() => encryptAndStore(name, clean))
          .then(() => logger.info('secrets.saved', { name, storage: 'secure-store' }))
          .catch((err: unknown) => {
            // אם ההצפנה נכשלה — המפתח נשאר לסשן בלבד, ומדווחים
            secure.delete(name);
            session.set(name, clean);
            logger.error('secrets.encrypt_failed', { name, error: err instanceof Error ? err.message : String(err) });
          });
      } else {
        session.set(name, clean);
        logger.warn('secrets.session_only', { name });
      }
    },
    clear(name) {
      secure.delete(name);
      session.delete(name);
      if (blobs[name]) {
        const next = { ...blobs };
        delete next[name];
        blobs = next;
        pending = pending.then(() => writeFile()).catch(() => undefined);
      }
      logger.info('secrets.cleared', { name });
    },
    status(): SecretsStatus {
      return { secureStorageAvailable: encryptionAvailable, entries: SECRET_NAMES.map(entry) };
    },
  };
}
