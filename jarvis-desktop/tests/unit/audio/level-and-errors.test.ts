import { describe, expect, it } from 'vitest';
import { rmsOf, rmsToLevel, stretchInto } from '../../../src/renderer/audio/level';
import { MIC_MESSAGES, toMicError } from '../../../src/renderer/audio/mic-errors';
import { MicError } from '../../../src/renderer/audio/types';
import { settleWithin } from '../../../src/renderer/audio/timers';
import { mockTimers } from './audio.mock';

describe('level helpers', () => {
  it('rmsOf computes the root mean square over a range', () => {
    expect(rmsOf(Float32Array.from([0.5, -0.5, 0.5, -0.5]))).toBeCloseTo(0.5);
    expect(rmsOf(Float32Array.from([1, 0, 0, 0]), 1, 4)).toBe(0);
    expect(rmsOf(new Float32Array(0))).toBe(0);
  });

  it('rmsToLevel maps -60..0 dBFS to 0..1', () => {
    expect(rmsToLevel(0)).toBe(0);
    expect(rmsToLevel(Number.NaN)).toBe(0);
    expect(rmsToLevel(0.001)).toBeCloseTo(0); // -60dB
    expect(rmsToLevel(0.01)).toBeCloseTo(1 / 3); // -40dB
    expect(rmsToLevel(0.1)).toBeCloseTo(2 / 3); // -20dB
    expect(rmsToLevel(1)).toBe(1);
    expect(rmsToLevel(4)).toBe(1);
  });

  it('stretchInto copies, stretches and shrinks waveforms', () => {
    const src = Float32Array.from([0, 1]);
    const same = new Float32Array(2);
    stretchInto(src, same);
    expect(Array.from(same)).toEqual([0, 1]);
    const wide = new Float32Array(5);
    stretchInto(src, wide);
    expect(Array.from(wide)).toEqual([0, 0.25, 0.5, 0.75, 1]);
    const narrow = new Float32Array(2);
    stretchInto(Float32Array.from([0, 0.5, 1, 0.5, 0]), narrow);
    expect(Array.from(narrow)).toEqual([0, 0]);
    const empty = new Float32Array(3).fill(9);
    stretchInto(new Float32Array(0), empty);
    expect(Array.from(empty)).toEqual([0, 0, 0]);
  });
});

describe('toMicError', () => {
  it('maps DOMException names to MicError kinds with Hebrew messages', () => {
    expect(toMicError(new DOMException('x', 'NotAllowedError'), false)).toMatchObject({
      kind: 'permission-denied',
      message: MIC_MESSAGES.permissionDenied,
    });
    expect(toMicError(new DOMException('x', 'NotFoundError'), false)).toMatchObject({
      kind: 'no-device',
      message: MIC_MESSAGES.noDevice,
    });
    expect(toMicError({ name: 'OverconstrainedError', constraint: 'deviceId' }, true)).toMatchObject({
      kind: 'no-device',
      message: MIC_MESSAGES.selectedDeviceMissing,
    });
    expect(toMicError(new DOMException('x', 'NotReadableError'), false).kind).toBe('device-busy');
    expect(toMicError(new DOMException('x', 'NotSupportedError'), false).kind).toBe('unsupported');
    expect(toMicError('weird', false).kind).toBe('unknown');
    expect(toMicError(null, false).kind).toBe('unknown');
  });

  it('passes MicError through unchanged', () => {
    const original = new MicError('device-busy', 'x');
    expect(toMicError(original, false)).toBe(original);
  });
});

describe('settleWithin (mock timers)', () => {
  it('reports ok, failed and timeout without throwing (mock)', async () => {
    const timers = mockTimers();
    await expect(settleWithin(Promise.resolve(5), 100, timers)).resolves.toEqual({ status: 'ok', value: 5 });
    const error = new Error('boom');
    await expect(settleWithin(Promise.reject(error), 100, timers)).resolves.toEqual({ status: 'failed', error });
    const never = settleWithin(new Promise<number>(() => undefined), 100, timers);
    timers.advance(100);
    await expect(never).resolves.toEqual({ status: 'timeout' });
    expect(timers.pendingCount).toBe(0);
  });
});
