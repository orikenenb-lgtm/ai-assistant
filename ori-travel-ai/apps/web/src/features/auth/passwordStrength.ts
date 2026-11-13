/** Client-side mirror of the server's password rules (app/core/security.py). Server remains authoritative. */
export const MIN_PASSWORD_LENGTH = 10;
export const MAX_PASSWORD_LENGTH = 256;

export interface PasswordCheck {
  lengthOk: boolean;
  classes: number;
  classesOk: boolean;
  valid: boolean;
  /** 0 (empty) … 4 (strong) — for the hint meter only. */
  score: 0 | 1 | 2 | 3 | 4;
}

const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password123', 'passw0rd', 'qwerty', 'qwerty123', 'qwertyuiop', '123456', '1234567',
  '12345678', '123456789', '1234567890', '111111', '000000', 'abc123', 'iloveyou', 'letmein', 'welcome', 'admin',
  'admin123', 'monkey', 'dragon', 'football', 'sunshine', 'princess', 'shalom', 'israel', 'israel123', 'telaviv',
  'jerusalem',
]);

/** Passphrases of this length are accepted with fewer character classes (server rule). */
export const PASSPHRASE_LENGTH = 16;

export function checkPassword(password: string): PasswordCheck {
  // Same classes as the server: lowercase, uppercase, digit, non-alphanumeric.
  // Note: caseless letters (e.g. Hebrew) count as alphanumeric but not as lower/upper.
  const classes = [/\p{Ll}/u, /\p{Lu}/u, /\p{Nd}/u, /[^\p{L}\p{N}]/u].filter((re) => re.test(password)).length;
  const lengthOk = password.length >= MIN_PASSWORD_LENGTH && password.length <= MAX_PASSWORD_LENGTH;
  const classesOk = classes >= 3 || password.length >= PASSPHRASE_LENGTH;
  let score: PasswordCheck['score'] = 0;
  if (password.length > 0) score = 1;
  if (lengthOk && classes >= 2) score = 2;
  if (lengthOk && classesOk) score = 3;
  if (password.length >= 14 && classes >= 3) score = 4;
  const valid = lengthOk && classesOk && !tooRepetitive(password) && !isCommon(password);
  return { lengthOk, classes, classesOk, valid, score: valid ? score : (Math.min(score, 1) as PasswordCheck['score']) };
}

function tooRepetitive(password: string): boolean {
  if (!password) return false;
  const counts = new Map<string, number>();
  for (const ch of password) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  return Math.max(...counts.values()) * 2 >= [...password].length;
}

function isCommon(password: string): boolean {
  const lower = password.toLowerCase();
  const normalized = lower.replace(/[^\p{L}\p{N}]/gu, '');
  return COMMON_PASSWORDS.has(lower) || COMMON_PASSWORDS.has(normalized);
}

export function passwordError(password: string): string | null {
  if (!password) return 'יש להזין סיסמה';
  if (password.length < MIN_PASSWORD_LENGTH) return `הסיסמה חייבת להכיל לפחות ${MIN_PASSWORD_LENGTH} תווים`;
  if (password.length > MAX_PASSWORD_LENGTH) return 'הסיסמה ארוכה מדי';
  if (!checkPassword(password).classesOk)
    return 'הסיסמה צריכה לשלב לפחות שלושה סוגי תווים (אותיות קטנות, גדולות, ספרות, סימנים) — או להיות משפט סיסמה של 16 תווים ומעלה';
  if (tooRepetitive(password)) return 'הסיסמה חוזרת על אותו תו יותר מדי פעמים';
  if (isCommon(password)) return 'זו סיסמה נפוצה מדי — בחרו סיסמה אחרת';
  return null;
}
