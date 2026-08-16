import { describe, expect, it } from 'vitest';
import {
  addMoney,
  compareMoney,
  convertMoney,
  formatAmountMicros,
  parseAmountMicros,
  roundHalfEven,
  subMoney,
} from '../../src/canonical/money.js';

describe('Fixed-Point Money and Half-Even Rounding', () => {
  it('parses canonical amountMicros strings and rejects invalid formats', () => {
    expect(parseAmountMicros('0')).toBe(0n);
    expect(parseAmountMicros('1000000')).toBe(1000000n);
    expect(parseAmountMicros('-500')).toBe(-500n);

    // Invalid non-canonical formats
    expect(() => parseAmountMicros('0123')).toThrow();
    expect(() => parseAmountMicros('-0')).toThrow();
    expect(() => parseAmountMicros('12.34')).toThrow();
    expect(() => parseAmountMicros('+100')).toThrow();
  });

  it('performs half-even rounding (Banker rounding)', () => {
    // 2.5 (5/2) -> rounds to even 2
    expect(roundHalfEven(5n, 2n)).toBe(2n);
    // 3.5 (7/2) -> rounds to even 4
    expect(roundHalfEven(7n, 2n)).toBe(4n);
    // 2.4 (12/5) -> 2
    expect(roundHalfEven(12n, 5n)).toBe(2n);
    // 2.6 (13/5) -> 3
    expect(roundHalfEven(13n, 5n)).toBe(3n);
  });

  it('adds and subtracts money with matching currency', () => {
    const a = { amountMicros: '1000000', currency: 'USD' };
    const b = { amountMicros: '2500000', currency: 'USD' };

    const sum = addMoney(a, b);
    expect(sum).toEqual({ amountMicros: '3500000', currency: 'USD' });

    const diff = subMoney(b, a);
    expect(diff).toEqual({ amountMicros: '1500000', currency: 'USD' });
  });

  it('handles currency conversion and 1-hop triangulation', () => {
    const rates = [
      { fromCurrency: 'USD', toCurrency: 'EUR', rateNumerator: 85n, rateDenominator: 100n },
      { fromCurrency: 'EUR', toCurrency: 'GBP', rateNumerator: 86n, rateDenominator: 100n },
    ];

    const usd = { amountMicros: '1000000', currency: 'USD' }; // $1.00

    // Direct USD -> EUR
    const eur = convertMoney(usd, 'EUR', rates);
    expect(eur).toEqual({ amountMicros: '850000', currency: 'EUR' });

    // 1-hop USD -> GBP via EUR
    const gbp = convertMoney(usd, 'GBP', rates, 'EUR');
    // 1,000,000 * 85 * 86 / (100 * 100) = 7,310,000 / 10 = 731,000
    expect(gbp).toEqual({ amountMicros: '731000', currency: 'GBP' });
  });
});
