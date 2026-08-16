import { describe, expect, it } from 'vitest';
import { Compiler, CapabilitySnapshot, PolicySnapshot } from '../../src/compiler/compiler.js';
import { verifyDecisionRecord } from '../../src/decision/verifier.js';
import { SchemaRegistry } from '../../src/registry/attribute-registry.js';
import { CompileRequest, GoalSpec, PlanningContext } from '../../src/types/index.js';

describe('10-Step Pure Compiler Engine', () => {
  const registry = new SchemaRegistry();
  registry.registerAssertionType({
    name: 'com.example.geo/user-location@v1',
    owner: 'secops',
    subjectSchema: { digest: 'sha256:111' },
    outputRoles: {},
  });

  const compiler = new Compiler(registry);

  const goalSpec: GoalSpec = {
    apiVersion: 'evidence.engine/v1alpha1',
    kind: 'InvestigationGoal',
    metadata: { tenant: 'tenant-acme', createdAt: 1000000 },
    assertions: [
      {
        uid: 'assert-1',
        type: 'com.example.geo/user-location@v1',
        subject: { type: 'core/string', value: 'user-123' },
        required: true,
      },
    ],
    constraints: {},
  };

  const capabilitySnapshot: CapabilitySnapshot = {
    capabilities: [
      {
        capabilityUid: 'cap-ip-geo-v1',
        targetAssertionTypes: ['com.example.geo/user-location@v1'],
        attributes: {
          'com.example/tier@v1': { type: 'core/string', value: 'GOLD' },
        },
        credentialScope: { scopeId: 'scope-default', allowedCapabilities: ['cap-ip-geo-v1'] },
        costMicros: '100000',
        currency: 'USD',
      },
    ],
    productionFrontier: ['com.example.geo/user-location@v1'],
  };

  const policySnapshot: PolicySnapshot = {
    unknownAdmissible: false,
    policyRulesAllowed: [],
  };

  const context: PlanningContext = {
    capabilitySnapshot: { digest: 'sha256:cap', schemaVersion: 'v1' },
    policySnapshot: { digest: 'sha256:pol', schemaVersion: 'v1' },
    strategyBundle: { digest: 'sha256:bundle', version: '1.0.0' },
    operationalFacts: [
      {
        capabilityUid: 'cap-ip-geo-v1',
        version: '1',
        observedAt: 900000,
        validUntil: 2000000,
      },
    ],
    stateFacts: [],
    planningInstant: 1000000,
    integrityDigest: 'sha256:ctx-integrity',
  };

  const compileRequest: CompileRequest = {
    goal: { digest: 'sha256:goal' },
    context: { digest: 'sha256:ctx' },
    traceLevel: 'VERBOSE_AUDIT',
  };

  it('compiles goal and context into execution graph and decision record', () => {
    const graph = compiler.compile(compileRequest, goalSpec, context, capabilitySnapshot, policySnapshot);

    expect(graph.status).toBe('READY');
    expect(graph.nodes.length).toBe(1);
    expect(graph.nodes[0]?.kind).toBe('core/ACQUIRE');
    expect(graph.nodes[0]?.spec.capabilityUid).toBe('cap-ip-geo-v1');
    expect(graph.decisionRecordRef.digest).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('guarantees 100% byte-identical compilation output across multiple runs (AC-1, Invariant 1)', () => {
    const run1 = compiler.compile(compileRequest, goalSpec, context, capabilitySnapshot, policySnapshot);
    const run2 = compiler.compile(compileRequest, goalSpec, context, capabilitySnapshot, policySnapshot);

    expect(run1.decisionRecordRef.digest).toBe(run2.decisionRecordRef.digest);
    expect(run1.graphUid).toBe(run2.graphUid);
  });

  it('guarantees permutation-stable decision record digests regardless of capability snapshot order (AC-2)', () => {
    const cap1 = capabilitySnapshot.capabilities[0]!;
    const cap2 = {
      capabilityUid: 'cap-ip-geo-v2-premium',
      targetAssertionTypes: ['com.example.geo/user-location@v1'],
      attributes: { 'com.example/tier@v1': { type: 'core/string', value: 'PLATINUM' } },
      credentialScope: { scopeId: 'scope-default', allowedCapabilities: ['cap-ip-geo-v2-premium'] },
      costMicros: '200000',
      currency: 'USD',
    };

    const permA: CapabilitySnapshot = {
      capabilities: [cap1, cap2],
      productionFrontier: ['com.example.geo/user-location@v1'],
    };

    const permB: CapabilitySnapshot = {
      capabilities: [cap2, cap1],
      productionFrontier: ['com.example.geo/user-location@v1'],
    };

    const runA = compiler.compile(compileRequest, goalSpec, context, permA, policySnapshot);
    const runB = compiler.compile(compileRequest, goalSpec, context, permB, policySnapshot);

    expect(runA.decisionRecordRef.digest).toBe(runB.decisionRecordRef.digest);
  });

  it('compiles multi-node GoalInternalBinding data flow edges and inputBindings (AC-5)', () => {
    registry.registerAssertionType({
      name: 'com.example.geo/ip-lookup@v1',
      owner: 'secops',
      subjectSchema: { digest: 'sha256:ip' },
      outputRoles: { user_ip: { type: 'core/string' } },
    });

    const multiGoal: GoalSpec = {
      apiVersion: 'evidence.engine/v1alpha1',
      kind: 'InvestigationGoal',
      metadata: { tenant: 'tenant-acme', createdAt: 1000000 },
      assertions: [
        {
          uid: 'assert-ip',
          type: 'com.example.geo/ip-lookup@v1',
          subject: { type: 'core/string', value: '1.1.1.1' },
          required: true,
        },
        {
          uid: 'assert-geo',
          type: 'com.example.geo/user-location@v1',
          subject: { source: 'NODE_OUTPUT', assertionUid: 'assert-ip', outputRole: 'user_ip' },
          required: true,
        },
      ],
      constraints: {},
    };

    const multiCapSnapshot: CapabilitySnapshot = {
      capabilities: [
        {
          capabilityUid: 'cap-ip-lookup-v1',
          targetAssertionTypes: ['com.example.geo/ip-lookup@v1'],
          attributes: { 'com.example/tier@v1': { type: 'core/string', value: 'GOLD' } },
          credentialScope: { scopeId: 'scope-default', allowedCapabilities: ['cap-ip-lookup-v1'] },
          costMicros: '50000',
          currency: 'USD',
        },
        {
          capabilityUid: 'cap-ip-geo-v1',
          targetAssertionTypes: ['com.example.geo/user-location@v1'],
          attributes: { 'com.example/tier@v1': { type: 'core/string', value: 'GOLD' } },
          credentialScope: { scopeId: 'scope-default', allowedCapabilities: ['cap-ip-geo-v1'] },
          costMicros: '100000',
          currency: 'USD',
        },
      ],
      productionFrontier: ['com.example.geo/ip-lookup@v1', 'com.example.geo/user-location@v1'],
    };

    const graph = compiler.compile(compileRequest, multiGoal, context, multiCapSnapshot, policySnapshot);

    expect(graph.status).toBe('READY');
    expect(graph.nodes.length).toBe(2);
    expect(graph.edges.length).toBe(1);
    expect(graph.edges[0]).toEqual({
      fromNodeUid: 'node-1',
      toNodeUid: 'node-2',
      bindingRole: 'user_ip',
    });
    expect(graph.nodes[1]?.dataFlow.inputBindings['user_ip']).toBeDefined();
    expect(graph.nodes[1]?.dataFlow.inputBindings['user_ip']?.sourceNodeUid).toBe('node-1');
  });

  it('throws CompilerError SUBJECT_KEY_UNAVAILABLE when isPersonalData is true and subjectKeys is missing', () => {
    const personalCapSnapshot: CapabilitySnapshot = {
      capabilities: [
        {
          capabilityUid: 'cap-personal-v1',
          targetAssertionTypes: ['com.example.geo/user-location@v1'],
          attributes: { 'com.example/ssn@v1': { type: 'core/string', value: '000-11-2222' } },
          credentialScope: { scopeId: 'scope-default', allowedCapabilities: ['cap-personal-v1'] },
          costMicros: '100000',
          currency: 'USD',
          isPersonalData: true,
        },
      ],
      productionFrontier: ['com.example.geo/user-location@v1'],
    };

    const personalContext: PlanningContext = {
      ...context,
      operationalFacts: [
        { capabilityUid: 'cap-personal-v1', version: '1', observedAt: 900000, validUntil: 2000000 },
      ],
    };

    expect(() =>
      compiler.compile(compileRequest, goalSpec, personalContext, personalCapSnapshot, policySnapshot)
    ).toThrow(/SUBJECT_KEY_UNAVAILABLE/);
  });

  it('throws CONTEXT_INTEGRITY_VIOLATION on expired operational fact', () => {
    const expiredContext: PlanningContext = {
      ...context,
      operationalFacts: [
        {
          capabilityUid: 'cap-ip-geo-v1',
          version: '1',
          observedAt: 500000,
          validUntil: 999999, // < planningInstant (1000000)
        },
      ],
    };

    expect(() =>
      compiler.compile(compileRequest, goalSpec, expiredContext, capabilitySnapshot, policySnapshot)
    ).toThrow(/CONTEXT_INTEGRITY_VIOLATION/);
  });

  it('emits graph status UNSATISFIABLE and decision record when goal assertion is outside frontier (AC-18)', () => {
    const closedSnapshot: CapabilitySnapshot = {
      ...capabilitySnapshot,
      productionFrontier: [], // empty frontier
    };

    const graph = compiler.compile(compileRequest, goalSpec, context, closedSnapshot, policySnapshot);

    expect(graph.status).toBe('UNSATISFIABLE');
    expect(graph.unmetAssertions.length).toBeGreaterThan(0);
    expect(graph.decisionRecordRef.digest).toBeDefined();
  });

  it('refuses to compile a core/ACQUIRE whose capability declares no CredentialScope (§11.5)', () => {
    const scopelessSnapshot: CapabilitySnapshot = {
      ...capabilitySnapshot,
      capabilities: capabilitySnapshot.capabilities.map(c => {
        const { credentialScope, ...rest } = c as any;
        return rest;
      }),
    };

    expect(() =>
      compiler.compile(compileRequest, goalSpec, context, scopelessSnapshot, policySnapshot)
    ).toThrow(/CREDENTIAL_SCOPE_REQUIRED/);
  });

  it('every compiled core/ACQUIRE node carries a CredentialScope (standing invariant)', () => {
    const graph = compiler.compile(compileRequest, goalSpec, context, capabilitySnapshot, policySnapshot);
    const acquires = graph.nodes.filter(n => n.kind === 'core/ACQUIRE');

    expect(acquires.length).toBeGreaterThan(0);
    for (const n of acquires) {
      expect(n.spec.credentialScope, `node ${n.uid} has no CredentialScope`).toBeDefined();
    }
  });
});
