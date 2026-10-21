/**
 * קידוד WAV והמרת קצב דגימה — פונקציות טהורות, בלי Web Audio, כדי שאפשר לבדוק אותן ב-node.
 *
 * בחירת שיטת ההמרה (מתועדת לפי הדרישה):
 * - בדרך הרגילה MicCapture פותח AudioContext בקצב 16kHz, ו-Chromium עצמו ממיר את אות המיקרופון
 *   (resampler מבוסס sinc איכותי). אז resampleTo16k היא העתקה בלבד.
 * - אם המערכת סירבה לקצב 16kHz, אנחנו ממירים בעצמנו: קודם מסנן מעביר-נמוכים FIR מסוג windowed-sinc
 *   (חלון Blackman, תדר קטעון 6.8kHz, פס מעבר שנגמר ב-8kHz) כדי למנוע aliasing של עיצורים שורקים
 *   (ש/ס/צ) אל תוך תחום הדיבור, ואחר כך אינטרפולציה לינארית למיקומי הדגימות החדשים.
 *   אינטרפולציה לינארית לבדה (בלי סינון) מקפלת תדרים מעל 8kHz ופוגעת בתמלול.
 */

export const TARGET_SAMPLE_RATE = 16_000;
const WAV_HEADER_BYTES = 44;

function assertRate(rate: number, label: string): void {
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new RangeError(`${label}: קצב דגימה לא תקין (${rate})`);
  }
}

/** ממיר דגימה בודדת (-1..1) למספר 16 ביט עם קיטום. NaN נחשב שקט. */
export function floatToInt16(sample: number): number {
  if (!Number.isFinite(sample)) {
    // NaN -> שקט; אינסוף -> קיטום לקצה המתאים
    if (sample === Infinity) return 32767;
    if (sample === -Infinity) return -32768;
    return 0;
  }
  if (sample >= 1) return 32767;
  if (sample <= -1) return -32768;
  return sample < 0 ? Math.max(-32768, Math.round(sample * 32768)) : Math.min(32767, Math.round(sample * 32767));
}

/**
 * מקודד דגימות מונו ל-WAV מסוג RIFF / PCM 16 ביט little-endian.
 * מבנה: כותרת של 44 בתים (RIFF, WAVE, fmt , data) ואחריה הדגימות.
 */
export function encodeWav16(samples: Float32Array, sampleRate: number): Uint8Array {
  assertRate(sampleRate, 'encodeWav16');
  if (!Number.isInteger(sampleRate)) throw new RangeError(`encodeWav16: קצב דגימה חייב להיות שלם (${sampleRate})`);
  const dataBytes = samples.length * 2;
  // שדות הגודל ב-RIFF הם 32 ביט
  if (WAV_HEADER_BYTES + dataBytes > 0xffffffff) throw new RangeError('encodeWav16: ההקלטה ארוכה מדי לקובץ WAV');

  const out = new Uint8Array(WAV_HEADER_BYTES + dataBytes);
  const view = new DataView(out.buffer);
  const ascii = (offset: number, text: string): void => {
    for (let i = 0; i < text.length; i++) out[offset + i] = text.charCodeAt(i);
  };

  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true); // גודל ה-chunk = כל הקובץ פחות 8 בתים
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true); // גודל fmt עבור PCM
  view.setUint16(20, 1, true); // audioFormat = PCM
  view.setUint16(22, 1, true); // ערוץ אחד (מונו)
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byteRate = rate * channels * 2
  view.setUint16(32, 2, true); // blockAlign = channels * 2
  view.setUint16(34, 16, true); // bitsPerSample
  ascii(36, 'data');
  view.setUint32(40, dataBytes, true);

  let offset = WAV_HEADER_BYTES;
  for (let i = 0; i < samples.length; i++) {
    view.setInt16(offset, floatToInt16(samples[i] ?? 0), true);
    offset += 2;
  }
  return out;
}

/**
 * המרת קצב דגימה באינטרפולציה לינארית בלבד (בלי סינון).
 * אורך הפלט: round(n * toRate / fromRate). מתאים להעלאת קצב, או להורדה אחרי סינון (ראה resampleTo16k).
 */
export function resampleLinear(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  assertRate(fromRate, 'resampleLinear');
  assertRate(toRate, 'resampleLinear');
  if (fromRate === toRate) return input.slice();
  const outLength = Math.round((input.length * toRate) / fromRate);
  const out = new Float32Array(outLength);
  if (input.length === 0 || outLength === 0) return out;
  const last = input.length - 1;
  const step = fromRate / toRate;
  for (let i = 0; i < outLength; i++) {
    const pos = i * step;
    const index = Math.floor(pos);
    if (index >= last) {
      out[i] = input[last] ?? 0;
      continue;
    }
    const frac = pos - index;
    const a = input[index] ?? 0;
    const b = input[index + 1] ?? 0;
    out[i] = a + (b - a) * frac;
  }
  return out;
}

/**
 * מסנן מעביר-נמוכים FIR (windowed-sinc, חלון Blackman), בהגבר 1 ב-DC.
 * הקצוות מרופדים באפסים (ההקלטה מתחילה ונגמרת בשקט יחסי, כך שאין השפעה מעשית).
 */
export function lowPassFir(input: Float32Array, sampleRate: number, cutoffHz: number, taps: number): Float32Array {
  assertRate(sampleRate, 'lowPassFir');
  if (!(cutoffHz > 0 && cutoffHz < sampleRate / 2)) throw new RangeError(`lowPassFir: תדר קטעון לא תקין (${cutoffHz})`);
  const n = Math.max(3, Math.floor(taps) | 1); // מספר מקדמים אי-זוגי -> מסנן סימטרי בלי הזזת פאזה חלקית
  const m = n - 1;
  const half = m / 2;
  const fc = cutoffHz / sampleRate;
  const kernel = new Float64Array(n);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const x = i - half;
    const sinc = x === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * x) / (Math.PI * x);
    const window = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / m) + 0.08 * Math.cos((4 * Math.PI * i) / m);
    const value = sinc * window;
    kernel[i] = value;
    sum += value;
  }
  for (let i = 0; i < n; i++) kernel[i] = (kernel[i] ?? 0) / sum;

  const out = new Float32Array(input.length);
  const len = input.length;
  for (let i = 0; i < len; i++) {
    let acc = 0;
    const start = i - half;
    const kFrom = Math.max(0, -start);
    const kTo = Math.min(n, len - start);
    for (let k = kFrom; k < kTo; k++) acc += (kernel[k] ?? 0) * (input[start + k] ?? 0);
    out[i] = acc;
  }
  return out;
}

/** מספר מקדמים למסנן כך שרוחב פס המעבר (Blackman ≈ 5.5·fs/N) יהיה בערך transitionHz. */
function tapsFor(sampleRate: number, transitionHz: number): number {
  return Math.min(1023, Math.ceil((5.5 * sampleRate) / transitionHz)) | 1;
}

/** ממיר כל קצב דגימה ל-16kHz מונו לתמלול. ראה הסבר בראש הקובץ. */
export function resampleTo16k(input: Float32Array, fromRate: number): Float32Array {
  assertRate(fromRate, 'resampleTo16k');
  if (fromRate === TARGET_SAMPLE_RATE) return input.slice();
  if (fromRate < TARGET_SAMPLE_RATE) return resampleLinear(input, fromRate, TARGET_SAMPLE_RATE);
  // קטעון 6.8kHz עם פס מעבר של 2.4kHz -> הנחתה מלאה מ-8kHz (תדר נייקוויסט של 16kHz) ומעלה
  const cutoff = 6_800;
  const filtered = lowPassFir(input, fromRate, cutoff, tapsFor(fromRate, 2_400));
  return resampleLinear(filtered, fromRate, TARGET_SAMPLE_RATE);
}

/** מחבר מקטעי דגימות לרצף אחד. */
export function concatFloat32(chunks: readonly Float32Array[], totalLength?: number): Float32Array {
  const total = totalLength ?? chunks.reduce((n, c) => n + c.length, 0);
  const out = new Float32Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    if (offset >= total) break;
    const part = offset + chunk.length > total ? chunk.subarray(0, total - offset) : chunk;
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
