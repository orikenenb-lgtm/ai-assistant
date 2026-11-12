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

export function checkPassword(password: string): PasswordCheck {
  // Same classes as the server: lowercase, uppercase, digit, non-alphanumeric.
  // Note: caseless letters (e.g. Hebrew) count as alphanumeric but not as lower/upper.
  const classes = [/\p{Ll}/u, /\p{Lu}/u, /\p{Nd}/u, /[^\p{L}\p{N}]/u].filter((re) => re.test(password)).length;
  const lengthOk = password.length >= MIN_PASSWORD_LENGTH && password.length <= MAX_PASSWORD_LENGTH;
  const classesOk = classes >= 2;
  let score: PasswordCheck['score'] = 0;
  if (password.length > 0) score = 1;
  if (lengthOk && classesOk) score = 2;
  if (lengthOk && classes >= 3) score = 3;
  if (password.length >= 14 && classes >= 3) score = 4;
  return { lengthOk, classes, classesOk, valid: lengthOk && classesOk, score };
}

export function passwordError(password: string): string | null {
  if (!password) return 'יש להזין סיסמה';
  if (password.length < MIN_PASSWORD_LENGTH) return `הסיסמה חייבת להכיל לפחות ${MIN_PASSWORD_LENGTH} תווים`;
  if (password.length > MAX_PASSWORD_LENGTH) return 'הסיסמה ארוכה מדי';
  if (!checkPassword(password).classesOk) return 'הסיסמה צריכה לשלב לפחות שני סוגי תווים (אותיות, ספרות, סימנים)';
  return null;
}
