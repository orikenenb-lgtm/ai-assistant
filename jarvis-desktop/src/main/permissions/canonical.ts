import { createHash } from 'node:crypto';

/**
 * JSON קנוני: מפתחות ממוינים, בלי רווחים, יציב בין ריצות.
 * משמש לקשירת אישור לפרמטרים מדויקים ולזיהוי פעולות כפולות.
 * הסמנטיקה כמו JSON.stringify (undefined/פונקציות מושמטים מאובייקטים, NaN/Infinity -> null),
 * אבל עם מיון מפתחות רקורסיבי וזריקת שגיאה על מבנה מעגלי.
 */
export function canonicalJson(value: unknown): string {
  const seen = new Set<object>();

  const encode = (v: unknown): string | undefined => {
    if (v === null) return 'null';
    switch (typeof v) {
      case 'string':
        return JSON.stringify(v);
      case 'number':
        return Number.isFinite(v) ? JSON.stringify(v) : 'null';
      case 'boolean':
        return v ? 'true' : 'false';
      case 'bigint':
        return JSON.stringify(v.toString());
      case 'undefined':
      case 'function':
      case 'symbol':
        return undefined;
      default:
        break;
    }
    const obj = v as object;
    // Date וכל אובייקט עם toJSON — כמו ב-JSON.stringify
    const maybeToJson = (obj as { toJSON?: unknown }).toJSON;
    if (typeof maybeToJson === 'function') {
      return encode((maybeToJson as () => unknown).call(obj));
    }
    if (seen.has(obj)) throw new TypeError('canonicalJson: circular structure');
    seen.add(obj);
    try {
      if (Array.isArray(obj)) {
        return `[${obj.map((item) => encode(item) ?? 'null').join(',')}]`;
      }
      if (obj instanceof Uint8Array) {
        return JSON.stringify(Buffer.from(obj).toString('base64'));
      }
      const entries = Object.keys(obj)
        .sort()
        .flatMap((key) => {
          const encoded = encode((obj as Record<string, unknown>)[key]);
          return encoded === undefined ? [] : [`${JSON.stringify(key)}:${encoded}`];
        });
      return `{${entries.join(',')}}`;
    } finally {
      seen.delete(obj);
    }
  };

  return encode(value) ?? 'null';
}

/** sha256 (hex) של שם הכלי + JSON קנוני של הפרמטרים. */
export function paramsHash(tool: string, params: unknown): string {
  return createHash('sha256').update(tool, 'utf8').update('\u0000', 'utf8').update(canonicalJson(params), 'utf8').digest('hex');
}
