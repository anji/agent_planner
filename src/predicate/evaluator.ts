import { canonicalizeJson } from '../canonical/jcs.js';
import { SchemaRegistry } from '../registry/attribute-registry.js';
import { KleeneBool, Predicate, TypedValue } from '../types/index.js';

function valuesEqual(a: TypedValue, b: TypedValue): boolean {
  if (a.type !== b.type) return false;
  return canonicalizeJson(a.value) === canonicalizeJson(b.value);
}

function compareValues(a: TypedValue, b: TypedValue): number | undefined {
  if (a.type !== b.type) return undefined;
  if (typeof a.value === 'number' && typeof b.value === 'number') {
    return a.value === b.value ? 0 : a.value < b.value ? -1 : 1;
  }
  if (typeof a.value === 'string' && typeof b.value === 'string') {
    return a.value === b.value ? 0 : a.value < b.value ? -1 : 1;
  }
  return undefined;
}

/**
 * Evaluates a Predicate against operational attribute facts under 3-valued Kleene logic (§7.3).
 * Absent or unknown attributes evaluate to UNKNOWN (never coerced to FALSE).
 */
export function evaluatePredicate(
  predicate: Predicate,
  attributes: Record<string, TypedValue>,
  registry?: SchemaRegistry
): KleeneBool {
  const attrName = predicate.attribute;
  const attrVal = attributes[attrName];

  if (predicate.op === 'PRESENT') {
    return attrVal !== undefined && attrVal.value !== undefined && attrVal.value !== null
      ? 'TRUE'
      : 'FALSE';
  }

  if (predicate.op === 'ABSENT') {
    return attrVal === undefined || attrVal.value === undefined || attrVal.value === null
      ? 'TRUE'
      : 'FALSE';
  }

  // All other operators over absent / unknown attributes yield UNKNOWN
  if (attrVal === undefined || attrVal.value === undefined || attrVal.value === null) {
    return 'UNKNOWN';
  }

  if (registry) {
    const attrDef = registry.getAttribute(attrName);
    if (attrDef) {
      // Validate ordering requirement for total ordering comparison ops
      if (['LT', 'LTE', 'GT', 'GTE'].includes(predicate.op) && attrDef.ordering !== 'TOTAL') {
        throw new Error(`Predicate op ${predicate.op} requires total ordering on attribute ${attrName}`);
      }
    }
  }

  switch (predicate.op) {
    case 'EQ':
      return valuesEqual(attrVal, predicate.value) ? 'TRUE' : 'FALSE';

    case 'NEQ':
      return valuesEqual(attrVal, predicate.value) ? 'FALSE' : 'TRUE';

    case 'IN': {
      const match = predicate.values.some(v => valuesEqual(attrVal, v));
      return match ? 'TRUE' : 'FALSE';
    }

    case 'NOT_IN': {
      const match = predicate.values.some(v => valuesEqual(attrVal, v));
      return match ? 'FALSE' : 'TRUE';
    }

    case 'LT': {
      const cmp = compareValues(attrVal, predicate.value);
      if (cmp === undefined) return 'UNKNOWN';
      return cmp < 0 ? 'TRUE' : 'FALSE';
    }

    case 'LTE': {
      const cmp = compareValues(attrVal, predicate.value);
      if (cmp === undefined) return 'UNKNOWN';
      return cmp <= 0 ? 'TRUE' : 'FALSE';
    }

    case 'GT': {
      const cmp = compareValues(attrVal, predicate.value);
      if (cmp === undefined) return 'UNKNOWN';
      return cmp > 0 ? 'TRUE' : 'FALSE';
    }

    case 'GTE': {
      const cmp = compareValues(attrVal, predicate.value);
      if (cmp === undefined) return 'UNKNOWN';
      return cmp >= 0 ? 'TRUE' : 'FALSE';
    }

    case 'SUPERSET_OF': {
      if (!Array.isArray(attrVal.value)) return 'UNKNOWN';
      const attrArr = attrVal.value as unknown[];
      const containsAll = predicate.values.every(target =>
        attrArr.some(item => canonicalizeJson(item) === canonicalizeJson(target.value))
      );
      return containsAll ? 'TRUE' : 'FALSE';
    }

    case 'INTERSECTS': {
      if (!Array.isArray(attrVal.value)) return 'UNKNOWN';
      const attrArr = attrVal.value as unknown[];
      const containsAny = predicate.values.some(target =>
        attrArr.some(item => canonicalizeJson(item) === canonicalizeJson(target.value))
      );
      return containsAny ? 'TRUE' : 'FALSE';
    }
  }
}
