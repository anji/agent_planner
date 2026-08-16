import { StrategyBundle, NamespacedType } from '../types/index.js';

export interface FrontierProofResult {
  isFeasible: boolean;
  missingAssertionTypes: NamespacedType[];
  frontierClosure: Set<NamespacedType>;
}

/**
 * Transitive Production Frontier Closure Engine (§10.2).
 * Proves static feasibility against the declared production frontier
 * BEFORE spending budget or invoking complex solvers (Step 6 of Compiler Pipeline).
 */
export class FrontierClosureEngine {
  /**
   * Calculates transitive production frontier closure from registered strategy bundles.
   */
  public computeFrontierClosure(bundles: StrategyBundle[]): Set<NamespacedType> {
    const closure = new Set<NamespacedType>();

    for (const bundle of bundles) {
      for (const targetType of bundle.declaredFrontier) {
        closure.add(targetType);
      }
      for (const contrib of bundle.contributions) {
        closure.add(contrib.targetAssertionType);
        if (contrib.kind === 'DECLARATIVE') {
          for (const role of contrib.outputRoles) {
            closure.add(role);
          }
        }
      }
    }

    return closure;
  }

  /**
   * Proves static feasibility for a set of required goal assertion types.
   */
  public proveStaticFeasibility(
    requiredAssertionTypes: NamespacedType[],
    frontierClosure: Set<NamespacedType>
  ): FrontierProofResult {
    const missing: NamespacedType[] = [];

    for (const reqType of requiredAssertionTypes) {
      if (!frontierClosure.has(reqType)) {
        missing.push(reqType);
      }
    }

    return {
      isFeasible: missing.length === 0,
      missingAssertionTypes: missing,
      frontierClosure,
    };
  }
}
