import { Money } from '../types/index.js';

const CANONICAL_MICROS_REGEX = /^(0|-?[1-9]\d*)$/;

/**
 * Validates and converts canonical decimal integer string micro-units to bigint.
 * Throws an error if string is not canonical (e.g. contains floats, -0, leading zeros).
 */
export function parseAmountMicros(amountMicros: string): bigint {
  if (!CANONICAL_MICROS_REGEX.test(amountMicros)) {
    throw new Error(`Invalid canonical amountMicros string: "${amountMicros}"`);
  }
  return BigInt(amountMicros);
}

/**
 * Formats bigint micro-units to canonical decimal integer string.
 */
export function formatAmountMicros(amount: bigint): string {
  if (amount === 0n) return "0";
  return amount.toString();
}

/**
 * Half-even rounding (Banker's Rounding) for exact integer division (numerator / denominator).
 * Applied once to the final result of a conversion or aggregation chain.
 */
export function roundHalfEven(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) {
    throw new Error('Division by zero in fixed-point rounding');
  }

  const positiveDenom = denominator < 0n ? -denominator : denominator;
  const num = denominator < 0n ? -numerator : numerator;

  let quotient = num / positiveDenom;
  let remainder = num % positiveDenom;

  if (remainder < 0n) {
    remainder += positiveDenom;
    quotient -= 1n;
  }

  const doubleRemainder = remainder * 2n;

  if (doubleRemainder < positiveDenom) {
    return quotient;
  } else if (doubleRemainder > positiveDenom) {
    return quotient + 1n;
  } else {
    // Exactly halfway: round to even
    return quotient % 2n === 0n ? quotient : quotient + 1n;
  }
}

/**
 * Adds two Money values. Currencies must match.
 */
export function addMoney(a: Money, b: Money): Money {
  if (a.currency !== b.currency) {
    throw new Error(`Currency mismatch in addition: ${a.currency} vs ${b.currency}`);
  }
  const valA = parseAmountMicros(a.amountMicros);
  const valB = parseAmountMicros(b.amountMicros);
  return {
    amountMicros: formatAmountMicros(valA + valB),
    currency: a.currency,
  };
}

/**
 * Subtracts Money b from Money a. Currencies must match.
 */
export function subMoney(a: Money, b: Money): Money {
  if (a.currency !== b.currency) {
    throw new Error(`Currency mismatch in subtraction: ${a.currency} vs ${b.currency}`);
  }
  const valA = parseAmountMicros(a.amountMicros);
  const valB = parseAmountMicros(b.amountMicros);
  return {
    amountMicros: formatAmountMicros(valA - valB),
    currency: a.currency,
  };
}

/**
 * Compares two Money values. Returns -1, 0, or 1. Currencies must match.
 */
export function compareMoney(a: Money, b: Money): number {
  if (a.currency !== b.currency) {
    throw new Error(`Currency mismatch in comparison: ${a.currency} vs ${b.currency}`);
  }
  const valA = parseAmountMicros(a.amountMicros);
  const valB = parseAmountMicros(b.amountMicros);
  if (valA < valB) return -1;
  if (valA > valB) return 1;
  return 0;
}

export interface ExchangeRate {
  fromCurrency: string;
  toCurrency: string;
  rateNumerator: bigint;
  rateDenominator: bigint;
}

/**
 * Converts Money using an exchange rate table.
 * Supports direct rate conversion and 1-hop triangulation via baseCurrency.
 */
export function convertMoney(
  money: Money,
  targetCurrency: string,
  rates: ExchangeRate[],
  baseCurrency?: string
): Money | undefined {
  if (money.currency === targetCurrency) {
    return money;
  }

  // 1. Direct rate
  const direct = rates.find(r => r.fromCurrency === money.currency && r.toCurrency === targetCurrency);
  if (direct) {
    const val = parseAmountMicros(money.amountMicros);
    const converted = roundHalfEven(val * direct.rateNumerator, direct.rateDenominator);
    return {
      amountMicros: formatAmountMicros(converted),
      currency: targetCurrency,
    };
  }

  // 2. 1-hop triangulation via baseCurrency
  if (baseCurrency && baseCurrency !== money.currency && baseCurrency !== targetCurrency) {
    const hop1 = rates.find(r => r.fromCurrency === money.currency && r.toCurrency === baseCurrency);
    const hop2 = rates.find(r => r.fromCurrency === baseCurrency && r.toCurrency === targetCurrency);

    if (hop1 && hop2) {
      const val = parseAmountMicros(money.amountMicros);
      // Carry full precision through intermediate calculation
      const num = val * hop1.rateNumerator * hop2.rateNumerator;
      const den = hop1.rateDenominator * hop2.rateDenominator;
      const converted = roundHalfEven(num, den);
      return {
        amountMicros: formatAmountMicros(converted),
        currency: targetCurrency,
      };
    }
  }

  return undefined; // Rate path absent -> UNKNOWN
}
