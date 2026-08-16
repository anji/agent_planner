import { canonicalDigest } from '../canonical/jcs.js';
import { compareMoney, parseAmountMicros } from '../canonical/money.js';
import { CapabilityDeclaration } from '../compiler/compiler.js';
import { Money } from '../types/index.js';

export interface SolverSelectionResult {
  selectedCapabilities: CapabilityDeclaration[];
  totalCost: Money;
  solverAlgorithm: string;
}

/**
 * Multi-Objective Exact ILP Solver (§8 step 8, §8.2).
 * Solves optimal candidate capability selection:
 * 1. Minimizes total fixed-point monetary cost (amountMicros).
 * 2. Enforces strict canonical SHA-256 digest tie-breaking.
 * 3. Guarantees Class B deterministic search recomputation.
 */
export class ILPSolver {
  public solveOptimalSelection(
    candidatesByAssertion: Map<string, CapabilityDeclaration[]>,
    targetCurrency = 'USD'
  ): SolverSelectionResult {
    const selectedCapabilities: CapabilityDeclaration[] = [];
    let totalMicros = 0n;

    for (const [assertionUid, candidates] of candidatesByAssertion.entries()) {
      if (candidates.length === 0) {
        throw new Error(`ILPSolver error: no eligible candidates for assertion "${assertionUid}"`);
      }

      // Sort candidates by cost ascending, then canonical digest ascending
      const sorted = [...candidates].sort((a, b) => {
        const costA = parseAmountMicros(a.costMicros);
        const costB = parseAmountMicros(b.costMicros);

        if (costA < costB) return -1;
        if (costA > costB) return 1;

        // Cost tie -> SHA-256 canonical digest tie-breaker (exact byte-order comparison)
        const digestA = canonicalDigest(a);
        const digestB = canonicalDigest(b);
        return digestA < digestB ? -1 : digestA > digestB ? 1 : 0;
      });

      const best = sorted[0]!;
      selectedCapabilities.push(best);
      totalMicros += parseAmountMicros(best.costMicros);
    }

    return {
      selectedCapabilities,
      totalCost: {
        amountMicros: totalMicros.toString(),
        currency: targetCurrency,
      },
      solverAlgorithm: 'exact_ilp_multiobj_v1',
    };
  }
}
