import { describe, expect, it } from 'vitest';
import { GoldenFileHarness } from '../../src/harness/golden-harness.js';
import { canonicalDigest } from '../../src/canonical/jcs.js';
import { DeclarativeContribution, GoalAssertion } from '../../src/types/index.js';

describe('Contributor Golden-File Test Harness', () => {
  const harness = new GoldenFileHarness();

  const contrib: DeclarativeContribution = {
    kind: 'DECLARATIVE',
    contributionUid: 'rule-table-001',
    targetAssertionType: 'com.example/check@v1',
    outputRoles: [],
    requiredPredicates: [
      { op: 'PRESENT', attribute: 'com.example/tier@v1' },
    ],
    nodeTemplates: [],
  };

  const assertion: GoalAssertion = {
    uid: 'a-100',
    type: 'com.example/check@v1',
    subject: { type: 'core/string', value: 'sub-1' },
    required: true,
  };

  it('evaluates requirement predicates and validates strategy contribution against golden file digest', () => {
    const witnessedAttributes = {
      'com.example/tier@v1': { type: 'core/string', value: 'GOLD' },
    };

    const expectedFragment = {
      fragmentUid: `frag-${contrib.contributionUid}-${assertion.uid}`,
      assertionUid: assertion.uid,
      requiredAttributePredicates: contrib.requiredPredicates,
      nodeTemplates: contrib.nodeTemplates,
    };
    const expectedDigest = canonicalDigest(expectedFragment);

    const scenario = {
      scenarioUid: 'scenario-01',
      description: 'Test active check assertion',
      inputAssertion: assertion,
      witnessedAttributes,
      expectedFragmentDigest: expectedDigest,
    };

    const res = harness.testDeclarativeContribution(contrib, scenario);
    expect(res.passed).toBe(true);
    expect(res.evaluatedPredicatesCount).toBe(1);
    expect(res.error).toBeUndefined();
  });
});
