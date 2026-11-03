import { describe, expect, it } from 'vitest';
import { numberSeries, seriesValue } from './series';

describe('numberSeries', () => {
  it('continues a series of decimals with as many places as its values have', () => {
    const s = numberSeries([0.1, 0.2])!;
    expect(seriesValue(s, 2)).toBe(0.3);
  });

  it('continues a series of numbers below 1E-06 instead of filling zeros', () => {
    expect(seriesValue(numberSeries([1e-7, 2e-7])!, 2)).toBeCloseTo(3e-7, 15);
    expect(seriesValue(numberSeries([1e-7, 2e-7])!, 3)).toBeCloseTo(4e-7, 15);
    expect(seriesValue(numberSeries([1.5e-7, 2.5e-7])!, 2)).toBeCloseTo(3.5e-7, 15);
    expect(seriesValue(numberSeries([1.5e-7, 2.5e-7])!, 2)).not.toBe(0);
  });
});
