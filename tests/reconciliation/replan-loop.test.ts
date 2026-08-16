import { describe, expect, it } from 'vitest';
import { ReadSetInvalidator } from '../../src/reconciliation/read-set-invalidator.js';
import { ReplanLoop } from '../../src/reconciliation/replan-loop.js';
import { Compiler } from '../../src/compiler/compiler.js';
import { SchemaRegistry } from '../../src/registry/attribute-registry.js';
import { DecisionRecord, GoalSpec, PlanningContext, CompileRequest } from '../../src/types/index.js';

describe('Cold Replan Loop & Read-Set Invalidation', () => {
  const invalidator = new ReadSetInvalidator();

  const decisionRecord: DecisionRecord = {
    apiVersion: 'evidence.engine/v1alpha1',
    kind: 'DecisionRecord',
    decisionDigest: 'sha256:dec-1',
    goalDigest: 'sha256:goal-1',
    contextIntegrityDigest: 'sha256:ctx-1',
    selectedCapabilities: [],
    candidateEvaluations: [],
    appliedRelaxations: [],
    provenance: { compilerVersion: '0.1.0', solverAlgorithm: 'v1', bundleDigest: 'd', timestamp: 1000 },
    readSet: [
      { resourceUid: 'cap-alpha', resourceType: 'Capability', version: 'v1', validUntil: 5000 },
    ],
    witnessedValues: [],
  };

  it('detects read-set validity when currentInstant < validUntil and versions match', () => {
    const res = invalidator.checkInvalidation(decisionRecord, [{ capabilityUid: 'cap-alpha', version: 'v1', observedAt: 1000, validUntil: 5000 }], 2000);
    expect(res.isInvalidated).toBe(false);
  });

  it('triggers read-set invalidation when validUntil is breached', () => {
    const res = invalidator.checkInvalidation(decisionRecord, [{ capabilityUid: 'cap-alpha', version: 'v1', observedAt: 1000, validUntil: 5000 }], 5001);
    expect(res.isInvalidated).toBe(true);
    expect(res.reason).toContain('expired');
  });

  it('triggers read-set invalidation when resource version advances', () => {
    const res = invalidator.checkInvalidation(decisionRecord, [{ capabilityUid: 'cap-alpha', version: 'v2', observedAt: 1000, validUntil: 5000 }], 2000);
    expect(res.isInvalidated).toBe(true);
    expect(res.reason).toContain('advanced');
  });

  it('executes replan loop and classifies attempts when invalidated', () => {
    const registry = new SchemaRegistry();
    registry.registerAssertionType({
      name: 'com.example/test@v1',
      owner: 'team-a',
      subjectSchema: { digest: 'd' },
      outputRoles: {},
    });

    const compiler = new Compiler(registry);
    const replanLoop = new ReplanLoop(compiler);

    const goalSpec: GoalSpec = {
      apiVersion: 'evidence.engine/v1alpha1',
      kind: 'InvestigationGoal',
      metadata: { tenant: 't1', createdAt: 1000 },
      assertions: [{ uid: 'a1', type: 'com.example/test@v1', subject: { type: 'core/string', value: 'v' }, required: true }],
      constraints: {},
    };

    const context: PlanningContext = {
      capabilitySnapshot: { digest: 'd', schemaVersion: 'v1' },
      policySnapshot: { digest: 'd', schemaVersion: 'v1' },
      strategyBundle: { digest: 'd', version: '1.0.0' },
      operationalFacts: [{ capabilityUid: 'cap-1', version: 'v1', observedAt: 1000, validUntil: 10000 }],
      stateFacts: [],
      planningInstant: 6000, // > validUntil (5000)
      integrityDigest: 'd',
    };

    const request: CompileRequest = {
      goal: { digest: 'g' },
      context: { digest: 'c' },
      traceLevel: 'NONE',
    };

    const capSnap = {
      capabilities: [
        {
          capabilityUid: 'cap-1',
          targetAssertionTypes: ['com.example/test@v1'],
          attributes: {},
          credentialScope: { scopeId: 'scope-default', allowedCapabilities: ['cap-1'] },
          costMicros: '100',
          currency: 'USD',
        },
      ],
      productionFrontier: ['com.example/test@v1'],
    };

    const polSnap = { unknownAdmissible: false, policyRulesAllowed: [] };

    const result = replanLoop.executeReplanIfInvalidated(
      decisionRecord,
      [],
      request,
      goalSpec,
      context,
      capSnap,
      polSnap
    );

    expect(result.replanExecuted).toBe(true);
    expect(result.newGraph).toBeDefined();
  });
});
