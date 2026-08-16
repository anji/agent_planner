import { canonicalDigest } from '../canonical/jcs.js';
import { evaluatePredicate } from '../predicate/evaluator.js';
import { DeclarativeContribution, GoalAssertion, Predicate, RequirementFragment, TypedValue } from '../types/index.js';

export interface GoldenScenario {
  scenarioUid: string;
  description: string;
  inputAssertion: GoalAssertion;
  witnessedAttributes?: Record<string, TypedValue>;
  expectedFragmentDigest: string;
}

export interface GoldenHarnessResult {
  scenarioUid: string;
  passed: boolean;
  actualDigest: string;
  expectedDigest: string;
  evaluatedPredicatesCount: number;
  error?: string;
}

/**
 * Contributor Golden-File Harness (§9.6, Architecture §7).
 * Enables Tier 0 & Tier 1 contributors to validate declarative rule tables
 * and strategy contributions against golden JSON files without control-plane access.
 */
export class GoldenFileHarness {
  public testDeclarativeContribution(
    contribution: DeclarativeContribution,
    scenario: GoldenScenario
  ): GoldenHarnessResult {
    try {
      if (contribution.targetAssertionType !== scenario.inputAssertion.type) {
        throw new Error(
          `Assertion type mismatch: contribution targets "${contribution.targetAssertionType}", scenario provided "${scenario.inputAssertion.type}"`
        );
      }

      // Re-evaluate required predicates against scenario attributes
      const evaluatedPredicates: Predicate[] = [];
      if (scenario.witnessedAttributes) {
        for (const pred of contribution.requiredPredicates) {
          const truth = evaluatePredicate(pred, scenario.witnessedAttributes);
          if (truth === 'TRUE') {
            evaluatedPredicates.push(pred);
          }
        }
      } else {
        evaluatedPredicates.push(...contribution.requiredPredicates);
      }

      const fragment: RequirementFragment = {
        fragmentUid: `frag-${contribution.contributionUid}-${scenario.inputAssertion.uid}`,
        assertionUid: scenario.inputAssertion.uid,
        requiredAttributePredicates: evaluatedPredicates,
        nodeTemplates: contribution.nodeTemplates,
      };

      const actualDigest = canonicalDigest(fragment);
      const passed = actualDigest === scenario.expectedFragmentDigest;

      const res: GoldenHarnessResult = {
        scenarioUid: scenario.scenarioUid,
        passed,
        actualDigest,
        expectedDigest: scenario.expectedFragmentDigest,
        evaluatedPredicatesCount: evaluatedPredicates.length,
      };

      if (!passed) {
        res.error = `Digest mismatch: expected "${scenario.expectedFragmentDigest}", got "${actualDigest}"`;
      }
      return res;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        scenarioUid: scenario.scenarioUid,
        passed: false,
        actualDigest: '',
        expectedDigest: scenario.expectedFragmentDigest,
        evaluatedPredicatesCount: 0,
        error: `Execution Error: ${msg}`,
      };
    }
  }
}
