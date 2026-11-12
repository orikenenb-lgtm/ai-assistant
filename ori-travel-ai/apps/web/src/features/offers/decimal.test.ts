import { describe, expect, it } from 'vitest';
import { compareDecimal, scoreNumber } from './decimal';

describe('compareDecimal', () => {
  it('orders exact decimals without float rounding', () => {
    expect(compareDecimal('5418.27', '5418.270')).toBe(0);
    expect(compareDecimal('0.1', '0.09')).toBe(1);
    expect(compareDecimal('99', '100')).toBe(-1);
    expect(compareDecimal('9007199254740993.01', '9007199254740993.02')).toBe(-1);
    expect(compareDecimal('-5', '3')).toBe(-1);
    expect(compareDecimal('-5', '-3')).toBe(-1);
    expect(compareDecimal('007', '7')).toBe(0);
  });
  it('clamps scores', () => {
    expect(scoreNumber('83.0')).toBe(83);
    expect(scoreNumber('abc')).toBe(0);
    expect(scoreNumber('140')).toBe(100);
  });
});
