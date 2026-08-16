import { canonicalizeJson } from '../canonical/jcs.js';
import { Binding, Condition, KleeneBool, TypedValue } from '../types/index.js';

export type BindingResolver = (binding: Binding) => TypedValue | undefined;

/**
 * Evaluates Graph Condition expressions under normative 3-valued Kleene truth tables (§7.6).
 *
 * Truth tables:
 * - ALL:  FALSE if any FALSE; else UNKNOWN if any UNKNOWN; else TRUE.
 * - ANY:  TRUE if any TRUE; else UNKNOWN if any UNKNOWN; else FALSE.
 * - NOT:  NOT TRUE => FALSE, NOT FALSE => TRUE, NOT UNKNOWN => UNKNOWN.
 */
export function evaluateCondition(
  condition: Condition,
  resolveBinding: BindingResolver
): KleeneBool {
  if ('all' in condition) {
    if (condition.all.length === 0) return 'TRUE';
    let hasUnknown = false;
    for (const sub of condition.all) {
      const res = evaluateCondition(sub, resolveBinding);
      if (res === 'FALSE') return 'FALSE';
      if (res === 'UNKNOWN') hasUnknown = true;
    }
    return hasUnknown ? 'UNKNOWN' : 'TRUE';
  }

  if ('any' in condition) {
    if (condition.any.length === 0) return 'FALSE';
    let hasUnknown = false;
    for (const sub of condition.any) {
      const res = evaluateCondition(sub, resolveBinding);
      if (res === 'TRUE') return 'TRUE';
      if (res === 'UNKNOWN') hasUnknown = true;
    }
    return hasUnknown ? 'UNKNOWN' : 'FALSE';
  }

  if ('not' in condition) {
    const res = evaluateCondition(condition.not, resolveBinding);
    if (res === 'TRUE') return 'FALSE';
    if (res === 'FALSE') return 'TRUE';
    return 'UNKNOWN';
  }

  if ('defined' in condition) {
    const bound = resolveBinding(condition.defined);
    return bound !== undefined && bound.value !== undefined && bound.value !== null
      ? 'TRUE'
      : 'FALSE';
  }

  if ('compare' in condition) {
    const { op, left, right } = condition.compare;
    const leftVal = resolveBinding(left);
    if (leftVal === undefined || leftVal.value === undefined) return 'UNKNOWN';

    let rightVal: TypedValue | undefined;
    if ('type' in right && 'value' in right) {
      rightVal = right as TypedValue;
    } else {
      rightVal = resolveBinding(right as Binding);
    }
    if (rightVal === undefined || rightVal.value === undefined) return 'UNKNOWN';

    if (leftVal.type !== rightVal.type) return 'UNKNOWN';

    const l = leftVal.value;
    const r = rightVal.value;

    switch (op) {
      case 'EQ':
        return canonicalizeJson(l) === canonicalizeJson(r) ? 'TRUE' : 'FALSE';
      case 'NEQ':
        return canonicalizeJson(l) !== canonicalizeJson(r) ? 'TRUE' : 'FALSE';
      case 'LT':
        if (typeof l !== 'number' || typeof r !== 'number') return 'UNKNOWN';
        return l < r ? 'TRUE' : 'FALSE';
      case 'LTE':
        if (typeof l !== 'number' || typeof r !== 'number') return 'UNKNOWN';
        return l <= r ? 'TRUE' : 'FALSE';
      case 'GT':
        if (typeof l !== 'number' || typeof r !== 'number') return 'UNKNOWN';
        return l > r ? 'TRUE' : 'FALSE';
      case 'GTE':
        if (typeof l !== 'number' || typeof r !== 'number') return 'UNKNOWN';
        return l >= r ? 'TRUE' : 'FALSE';
    }
  }

  return 'UNKNOWN';
}
