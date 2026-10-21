import { z } from 'zod';

/**
 * סכמת ההגדרות. main מאמת כל שינוי מול הסכמה לפני שמירה.
 * אין כאן מפתחות API — הם נשמרים בנפרד ב-SecretStore (safeStorage / DPAPI).
 */

const ID_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;

export const APP_KINDS = ['exe', 'shortcut', 'uri'] as const;
export type AppKind = (typeof APP_KINDS)[number];

/** סכמות URI שמותר לפתוח. רק פתיחת אפליקציה — בלי פרמטרים מהמודל. */
export const ALLOWED_URI_SCHEMES = ['spotify', 'discord', 'steam', 'slack', 'msteams', 'zoommtg', 'whatsapp'] as const;

export const AppEntrySchema = z
  .object({
    id: z.string().regex(ID_RE),
    name: z.string().trim().min(1).max(60),
    aliases: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
    kind: z.enum(APP_KINDS),
    /** נתיב ל-exe, נתיב לקיצור דרך (.lnk/.url), או URI כמו "spotify:" */
    target: z.string().max(1024).default(''),
    /** ארגומנטים שהמשתמש הגדיר בלבד. המודל לעולם לא מוסיף ארגומנטים. */
    args: z.array(z.string().max(512)).max(10).default([]),
    enabled: z.boolean().default(true),
    builtin: z.boolean().default(false),
  })
  .strict();
export type AppEntry = z.infer<typeof AppEntrySchema>;

export const PROJECT_KINDS = ['eplan', 'file', 'folder'] as const;

export const ProjectEntrySchema = z
  .object({
    id: z.string().regex(ID_RE),
    name: z.string().trim().min(1).max(80),
    aliases: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
    path: z.string().max(1024).default(''),
    kind: z.enum(PROJECT_KINDS).default('eplan'),
    enabled: z.boolean().default(true),
  })
  .strict();
export type ProjectEntry = z.infer<typeof ProjectEntrySchema>;

export const SettingsSchema = z
  .object({
    schemaVersion: z.literal(1).default(1),
    profile: z
      .object({
        userName: z.string().trim().min(1).max(40).default('אורי'),
        timezone: z.literal('Asia/Jerusalem').default('Asia/Jerusalem'),
        language: z.literal('he').default('he'),
      })
      .strict()
      .prefault({}),
    ui: z
      .object({
        mode: z.enum(['full', 'compact']).default('full'),
        alwaysOnTop: z.boolean().default(false),
        reducedMotion: z.enum(['system', 'on', 'off']).default('system'),
        closeToTray: z.boolean().default(true),
        startHidden: z.boolean().default(false),
        /** הפעלה אוטומטית בכניסה ל-Windows (כדי שתזכורות יפעלו גם אחרי הפעלה מחדש) */
        openAtLogin: z.boolean().default(false),
        trayHintShown: z.boolean().default(false),
      })
      .strict()
      .prefault({}),
    ai: z
      .object({
        provider: z.literal('anthropic').default('anthropic'),
        model: z
          .string()
          .regex(/^claude-[a-z0-9-]{1,60}$/)
          .default('claude-opus-5-5'),
        effort: z.enum(['low', 'medium', 'high']).default('low'),
        requestTimeoutSec: z.number().int().min(10).max(180).default(60),
        /** auto = Claude כשזמין, ופענוח מקומי כגיבוי. local-only = בלי ענן למוח. */
        brainMode: z.enum(['auto', 'local-only']).default('auto'),
        maxContextTurns: z.number().int().min(0).max(12).default(6),
      })
      .strict()
      .prefault({}),
    stt: z
      .object({
        provider: z.enum(['openai', 'azure', 'local-openai-compatible', 'none']).default('openai'),
        openaiModel: z.string().trim().min(1).max(64).default('gpt-transcribe'),
        localBaseUrl: z.string().trim().max(200).default('http://127.0.0.1:8000/v1'),
        localModel: z.string().trim().max(120).default(''),
      })
      .strict()
      .prefault({}),
    tts: z
      .object({
        provider: z.enum(['azure', 'openai', 'system', 'none']).default('system'),
        azureVoice: z
          .string()
          .regex(/^[a-z]{2}-[A-Z]{2}-[A-Za-z0-9:]+Neural$/)
          .default('he-IL-AvriNeural'),
        openaiModel: z.string().trim().min(1).max(64).default('gpt-4o-mini-tts'),
        openaiVoice: z.string().trim().min(1).max(32).default('onyx'),
        systemVoiceName: z.string().max(200).default(''),
        rate: z.number().min(0.5).max(2).default(1),
        autoSpeak: z.boolean().default(true),
      })
      .strict()
      .prefault({}),
    azure: z
      .object({
        region: z
          .string()
          .regex(/^[a-z0-9]{2,40}$/)
          .default('westeurope'),
      })
      .strict()
      .prefault({}),
    voice: z
      .object({
        pushToTalkHotkey: z.string().max(60).default('CommandOrControl+Alt+J'),
        silenceTimeoutMs: z.number().int().min(500).max(4000).default(1300),
        maxUtteranceSec: z.number().int().min(3).max(60).default(15),
        followUpListening: z.boolean().default(false),
        micDeviceId: z.string().max(200).default(''),
      })
      .strict()
      .prefault({}),
    wakeWord: z
      .object({
        enabled: z.boolean().default(false),
        engine: z.enum(['openwakeword', 'porcupine']).default('openwakeword'),
        sensitivity: z.number().min(0.1).max(0.95).default(0.5),
      })
      .strict()
      .prefault({}),
    launcher: z
      .object({
        apps: z.array(AppEntrySchema).max(50).default([]),
        projects: z.array(ProjectEntrySchema).max(30).default([]),
        defaultProjectId: z.string().max(40).default(''),
      })
      .strict()
      .prefault({}),
    screen: z
      .object({
        requireConfirmation: z.boolean().default(true),
        maxLongEdgePx: z.number().int().min(640).max(2576).default(1920),
      })
      .strict()
      .prefault({}),
    reminders: z
      .object({
        /** אם האפליקציה הייתה למטה עד X דקות אחרי מועד התזכורת — עדיין מתריעים כרגיל. אחרת: "הוחמצה". */
        graceMinutes: z.number().int().min(0).max(60).default(5),
      })
      .strict()
      .prefault({}),
    privacy: z
      .object({
        saveConversationHistory: z.boolean().default(true),
        historyRetentionDays: z.number().int().min(1).max(365).default(30),
        verboseLogs: z.boolean().default(false),
      })
      .strict()
      .prefault({}),
  })
  .strict();

export type Settings = z.infer<typeof SettingsSchema>;

/** עדכון חלקי: כל מקטע אופציונלי, ובתוכו כל שדה אופציונלי. מערכים מוחלפים בשלמותם. */
export type SettingsPatch = {
  [K in keyof Settings]?: Settings[K] extends Array<unknown>
    ? Settings[K]
    : Settings[K] extends object
      ? Partial<Settings[K]>
      : Settings[K];
};

/** תוכנות ופרויקטים שמוגדרים מראש (עם נתיב ריק עד שהמשתמש בוחר). */
export function defaultLauncher(): Settings['launcher'] {
  return {
    apps: [
      {
        id: 'eplan',
        name: 'EPLAN',
        aliases: ['eplan', 'אי פלאן', 'איפלאן', 'אפלן', 'e plan', 'eplan electric p8'],
        kind: 'exe',
        target: '',
        args: [],
        enabled: true,
        builtin: true,
      },
      {
        id: 'spotify',
        name: 'Spotify',
        aliases: ['spotify', 'ספוטיפיי', 'ספוטיפי'],
        kind: 'uri',
        target: 'spotify:',
        args: [],
        enabled: true,
        builtin: true,
      },
      {
        id: 'notepad',
        name: 'פנקס רשימות',
        aliases: ['notepad', 'נוטפד', 'פנקס רשימות'],
        kind: 'exe',
        target: 'C:\\Windows\\System32\\notepad.exe',
        args: [],
        enabled: true,
        builtin: true,
      },
      {
        id: 'calculator',
        name: 'מחשבון',
        aliases: ['calculator', 'calc', 'מחשבון'],
        kind: 'exe',
        target: 'C:\\Windows\\System32\\calc.exe',
        args: [],
        enabled: true,
        builtin: true,
      },
    ],
    projects: [
      {
        id: 'final-project',
        name: 'פרויקט הגמר',
        aliases: ['פרויקט הגמר', 'פרויקט הגמר שלי', 'הפרויקט שלי', 'פרויקט גמר', 'final project'],
        path: '',
        kind: 'eplan',
        enabled: true,
      },
    ],
    defaultProjectId: 'final-project',
  };
}

export function defaultSettings(): Settings {
  const base = SettingsSchema.parse({});
  return { ...base, launcher: defaultLauncher() };
}

export const SECRET_NAMES = ['anthropicApiKey', 'openaiApiKey', 'azureSpeechKey', 'picovoiceAccessKey'] as const;
export type SecretName = (typeof SECRET_NAMES)[number];

export interface SecretStatusEntry {
  name: SecretName;
  configured: boolean;
  source: 'secure-store' | 'env' | 'session' | 'none';
}

export interface SecretsStatus {
  secureStorageAvailable: boolean;
  entries: SecretStatusEntry[];
}

/** משתני סביבה שמשמשים גיבוי לפיתוח בלבד (ראה .env.example). */
export const SECRET_ENV_VARS: Record<SecretName, string> = {
  anthropicApiKey: 'ANTHROPIC_API_KEY',
  openaiApiKey: 'OPENAI_API_KEY',
  azureSpeechKey: 'AZURE_SPEECH_KEY',
  picovoiceAccessKey: 'PICOVOICE_ACCESS_KEY',
};
