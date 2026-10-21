import { describe, expect, it } from 'vitest';
import {
  concatFloat32,
  encodeWav16,
  floatToInt16,
  lowPassFir,
  resampleLinear,
  resampleTo16k,
} from '../../../src/renderer/audio/wav';
import { rmsOf } from '../../../src/renderer/audio/level';

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function sine(freq: number, sampleRate: number, seconds: number, amp = 0.5): Float32Array {
  const n = Math.round(sampleRate * seconds);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / sampleRate);
  return out;
}

/** הערכת תדר לפי חציות אפס עולות. */
function estimateFrequency(samples: Float32Array, sampleRate: number): number {
  let crossings = 0;
  let first = -1;
  let last = -1;
  for (let i = 1; i < samples.length; i++) {
    if ((samples[i - 1] ?? 0) < 0 && (samples[i] ?? 0) >= 0) {
      crossings++;
      if (first < 0) first = i;
      last = i;
    }
  }
  return ((crossings - 1) * sampleRate) / (last - first);
}

describe('encodeWav16', () => {
  it('writes a valid 44-byte RIFF/WAVE PCM 16-bit mono header', () => {
    const wav = encodeWav16(new Float32Array(100), 16_000);
    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    expect(wav.byteLength).toBe(44 + 200);
    expect(ascii(wav, 0, 4)).toBe('RIFF');
    expect(view.getUint32(4, true)).toBe(36 + 200);
    expect(ascii(wav, 8, 4)).toBe('WAVE');
    expect(ascii(wav, 12, 4)).toBe('fmt ');
    expect(view.getUint32(16, true)).toBe(16);
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint32(28, true)).toBe(32_000); // byteRate
    expect(view.getUint16(32, true)).toBe(2); // blockAlign
    expect(view.getUint16(34, true)).toBe(16);
    expect(ascii(wav, 36, 4)).toBe('data');
    expect(view.getUint32(40, true)).toBe(200);
  });

  it('produces a header-only file for empty input', () => {
    const wav = encodeWav16(new Float32Array(0), 16_000);
    const view = new DataView(wav.buffer);
    expect(wav.byteLength).toBe(44);
    expect(view.getUint32(4, true)).toBe(36);
    expect(view.getUint32(40, true)).toBe(0);
  });

  it('converts samples little-endian with clipping and NaN as silence', () => {
    const input = Float32Array.from([0, 1, -1, 0.5, -0.5, 1.7, -3, Number.NaN, 1e-6]);
    const wav = encodeWav16(input, 8_000);
    const view = new DataView(wav.buffer);
    const read = (i: number) => view.getInt16(44 + i * 2, true);
    expect(read(0)).toBe(0);
    expect(read(1)).toBe(32767);
    expect(read(2)).toBe(-32768);
    expect(read(3)).toBe(16384);
    expect(read(4)).toBe(-16384);
    expect(read(5)).toBe(32767); // קיטום
    expect(read(6)).toBe(-32768); // קיטום
    expect(read(7)).toBe(0);
    expect(read(8)).toBe(0);
    // little-endian: 32767 = 0xFF 0x7F
    expect(wav[46]).toBe(0xff);
    expect(wav[47]).toBe(0x7f);
  });

  it('floatToInt16 handles infinities', () => {
    expect(floatToInt16(Infinity)).toBe(32767);
    expect(floatToInt16(-Infinity)).toBe(-32768);
  });

  it('rejects invalid sample rates', () => {
    expect(() => encodeWav16(new Float32Array(1), 0)).toThrow(RangeError);
    expect(() => encodeWav16(new Float32Array(1), 44_100.5)).toThrow(RangeError);
    expect(() => encodeWav16(new Float32Array(1), Number.NaN)).toThrow(RangeError);
  });
});

describe('resampleLinear', () => {
  it('computes output length from the rate ratio', () => {
    expect(resampleLinear(new Float32Array(48_000), 48_000, 16_000).length).toBe(16_000);
    expect(resampleLinear(new Float32Array(44_100), 44_100, 16_000).length).toBe(16_000);
    expect(resampleLinear(new Float32Array(441), 44_100, 16_000).length).toBe(160);
    expect(resampleLinear(new Float32Array(8_000), 8_000, 16_000).length).toBe(16_000);
    expect(resampleLinear(new Float32Array(0), 48_000, 16_000).length).toBe(0);
  });

  it('returns a copy (not the same buffer) when rates match', () => {
    const input = Float32Array.from([0.1, 0.2]);
    const out = resampleLinear(input, 16_000, 16_000);
    expect(out).not.toBe(input);
    expect(Array.from(out)).toEqual(Array.from(input));
  });

  it('interpolates linearly between samples when upsampling', () => {
    const out = resampleLinear(Float32Array.from([0, 1, 0]), 1, 2);
    expect(out.length).toBe(6);
    expect(out[0]).toBeCloseTo(0);
    expect(out[1]).toBeCloseTo(0.5);
    expect(out[2]).toBeCloseTo(1);
    expect(out[3]).toBeCloseTo(0.5);
    expect(out[4]).toBeCloseTo(0);
    expect(out[5]).toBeCloseTo(0); // מעבר לסוף: נצמד לדגימה האחרונה
  });

  it('preserves the frequency of a sine (48k -> 16k and 44.1k -> 16k)', () => {
    for (const rate of [48_000, 44_100]) {
      const out = resampleLinear(sine(440, rate, 1), rate, 16_000);
      const f = estimateFrequency(out, 16_000);
      expect(Math.abs(f - 440) / 440).toBeLessThan(0.01);
    }
  });

  it('rejects invalid rates', () => {
    expect(() => resampleLinear(new Float32Array(4), 0, 16_000)).toThrow(RangeError);
    expect(() => resampleLinear(new Float32Array(4), 16_000, -1)).toThrow(RangeError);
  });
});

describe('resampleTo16k (anti-aliased)', () => {
  it('keeps speech-band tones and their frequency', () => {
    const input = sine(1_000, 48_000, 1);
    const out = resampleTo16k(input, 48_000);
    expect(out.length).toBe(16_000);
    expect(Math.abs(estimateFrequency(out, 16_000) - 1_000)).toBeLessThan(10);
    // תדר בתוך פס המעבר: כמעט בלי הנחתה (בודקים באמצע כדי להימנע מאפקט הקצוות)
    expect(rmsOf(out, 1_000, 15_000)).toBeGreaterThan(0.95 * rmsOf(input, 3_000, 45_000));
  });

  it('suppresses tones above 8 kHz instead of folding them into the speech band', () => {
    const input = sine(12_000, 48_000, 0.5);
    const naive = resampleLinear(input, 48_000, 16_000);
    const filtered = resampleTo16k(input, 48_000);
    // בלי סינון: 12kHz "מתקפל" ל-4kHz כמעט בלי הנחתה
    expect(rmsOf(naive, 500, 7_500)).toBeGreaterThan(0.2);
    // עם סינון: הנחתה של יותר מ-40dB
    expect(rmsOf(filtered, 500, 7_500)).toBeLessThan(0.01 * rmsOf(naive, 500, 7_500));
  });

  it('is a plain copy at 16 kHz and linear upsampling below it', () => {
    const input = sine(300, 16_000, 0.1);
    const same = resampleTo16k(input, 16_000);
    expect(same).not.toBe(input);
    expect(Array.from(same)).toEqual(Array.from(input));
    expect(resampleTo16k(new Float32Array(800), 8_000).length).toBe(1_600);
  });

  it('lowPassFir has unity DC gain', () => {
    const dc = new Float32Array(2_000).fill(0.3);
    const out = lowPassFir(dc, 48_000, 6_800, 101);
    expect(out[1_000]).toBeCloseTo(0.3, 5);
  });
});

describe('concatFloat32', () => {
  it('joins chunks and truncates to the requested length', () => {
    const a = Float32Array.from([1, 2, 3]);
    const b = Float32Array.from([4, 5]);
    expect(Array.from(concatFloat32([a, b]))).toEqual([1, 2, 3, 4, 5]);
    expect(Array.from(concatFloat32([a, b], 4))).toEqual([1, 2, 3, 4]);
    expect(Array.from(concatFloat32([a, b], 2))).toEqual([1, 2]);
  });
});
