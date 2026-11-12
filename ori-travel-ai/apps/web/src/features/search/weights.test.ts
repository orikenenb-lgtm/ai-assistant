import { describe, expect, it } from 'vitest';
import { DEFAULT_WEIGHTS, WEIGHT_PRESETS, rebalance, sumWeights, weightsToParam } from './weights';

describe('weights', () => {
  it('always sums to 100 after rebalancing', () => {
    for (const f of ['cost', 'convenience', 'flexibility', 'quality'] as const) {
      for (const v of [0, 7, 33, 50, 99, 100]) {
        const next = rebalance(DEFAULT_WEIGHTS, f, v);
        expect(sumWeights(next)).toBe(100);
        expect(next[f]).toBe(v);
        expect(Object.values(next).every((x) => Number.isInteger(x) && x >= 0)).toBe(true);
      }
    }
  });

  it('splits evenly when the other factors are all zero', () => {
    const next = rebalance({ cost: 100, convenience: 0, flexibility: 0, quality: 0 }, 'cost', 40);
    expect(next).toEqual({ cost: 40, convenience: 20, flexibility: 20, quality: 20 });
  });

  it('serializes to the API format and presets are valid', () => {
    expect(weightsToParam(DEFAULT_WEIGHTS)).toBe('cost:40,convenience:25,flexibility:20,quality:15');
    for (const p of WEIGHT_PRESETS) expect(sumWeights(p.weights)).toBe(100);
  });
});
