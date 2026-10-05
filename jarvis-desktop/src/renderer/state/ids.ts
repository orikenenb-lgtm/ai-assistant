/**
 * מזהה UUID v4 לכל שליחה (clientRequestId — main דוחה כפילויות לפיו).
 * crypto.randomUUID קיים רק בהקשר מאובטח; אם הפרוטוקול לא נרשם כ-secure — בונים UUID מ-getRandomValues.
 */
export function uuidV4(cryptoImpl: Pick<Crypto, 'getRandomValues'> & { randomUUID?: () => string } = crypto): string {
  if (typeof cryptoImpl.randomUUID === 'function') return cryptoImpl.randomUUID();
  const b = cryptoImpl.getRandomValues(new Uint8Array(16));
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x40; // גרסה 4
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80; // וריאנט RFC
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
