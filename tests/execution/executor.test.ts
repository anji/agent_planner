import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ExecutorEngine } from '../../src/execution/executor.js';
import { CredentialBroker } from '../../src/security/credential-broker.js';
import { ExecutionGraph, GraphNode } from '../../src/types/index.js';

describe('Executor Engine & Write-Ahead Intent Protocol (§11.4, §11.5, §11.7, AC-12)', () => {
  const node: GraphNode = {
    uid: 'node-200',
    kind: 'core/ACQUIRE',
    spec: {
      capabilityUid: 'cap-check-v2',
      credentialScope: {
        scopeId: 'scope-default',
        allowedCapabilities: ['cap-check-v2'],
      },
    },
    dataFlow: { inputBindings: {} },
    status: { phase: 'PENDING', attempts: [], lastTransitionAt: 1000 },
  };

  const testBroker = new CredentialBroker(randomBytes(32));

  const graph: ExecutionGraph = {
    graphUid: 'g-200',
    investigationUid: 'inv-corporate-diligence-999',
    metadata: { tenant: 't1', createdAt: 1000 },
    provenance: { compilerVersion: '0.1.0', solverAlgorithm: 'v1', bundleDigest: 'd', timestamp: 1000 },
    nodes: [node],
    edges: [],
    status: 'READY',
    unmetAssertions: [],
    decisionRecordRef: { digest: 'd', mediaType: 'app/json', sizeBytes: 10 },
  };

  it('records intent log before invoking external provider (Write-Ahead Protocol)', async () => {
    const mockInvoker = {
      invoke: async () => ({ status: 'SUCCESS' as const, outputExtentRef: 'extent-123' }),
    };

    const executor = new ExecutorEngine(mockInvoker, testBroker);
    const outcome = await executor.executeNodeAttempt(graph, node, 0, 1, 'KEYED', 1000, 'sha256:policy-v1');

    expect(outcome.status).toBe('SUCCESS');
    expect(executor.getIntentLog().length).toBe(1);
    expect(executor.getIntentLog()[0]?.idempotencyKey).toMatch(/^ik-node-200-ord0-att1-/);
    expect(executor.getOutcomeLog().length).toBe(1);
  });

  it('obtains and validates CredentialToken via CredentialBroker during execution (§11.5)', async () => {
    const secretKey = randomBytes(32);
    const broker = new CredentialBroker(secretKey);

    const scopedNode: GraphNode = {
      uid: 'node-scoped-1',
      kind: 'core/ACQUIRE',
      spec: {
        capabilityUid: 'cap-sensitive-kyb',
        credentialScope: {
          scopeId: 'scope-fintech-1',
          allowedCapabilities: ['cap-sensitive-kyb'],
        },
      },
      dataFlow: { inputBindings: {} },
      status: { phase: 'PENDING', attempts: [], lastTransitionAt: 1000 },
    };

    let receivedIntentToken: string | undefined;

    const mockInvoker = {
      invoke: async (intent: any) => {
        receivedIntentToken = intent.credentialToken?.tokenId;
        return { status: 'SUCCESS' as const };
      },
    };

    const executor = new ExecutorEngine(mockInvoker, broker);
    const outcome = await executor.executeNodeAttempt(graph, scopedNode, 0, 1, 'KEYED', 1000, 'sha256:policy-v1');

    expect(outcome.status).toBe('SUCCESS');
    expect(receivedIntentToken).toBeDefined();
    expect(receivedIntentToken).toMatch(/^cred-/);
  });

  it('handles IndeterminateResolution for NONE capabilities (§11.7)', async () => {
    const mockInvoker = {
      invoke: async () => {
        throw new Error('Network timeout during provider invocation');
      },
    };

    const executor = new ExecutorEngine(mockInvoker, testBroker);
    const outcome = await executor.executeNodeAttempt(graph, node, 0, 1, 'NONE', 1000, 'sha256:policy-v1');

    expect(outcome.status).toBe('INDETERMINATE');

    const resolution = executor.resolveIndeterminate(outcome, 'NONE');
    expect(resolution.action).toBe('WITHHOLD_RETRY');
  });

  it('refuses to invoke a core/ACQUIRE node that carries no CredentialScope (§11.5 fail-closed)', async () => {
    let invoked = false;
    const mockInvoker = {
      invoke: async () => {
        invoked = true;
        return { status: 'SUCCESS' as const };
      },
    };

    const scopelessNode: GraphNode = {
      uid: 'node-scopeless',
      kind: 'core/ACQUIRE',
      spec: { capabilityUid: 'cap-restricted-pii' },
      dataFlow: { inputBindings: {} },
      status: { phase: 'PENDING', attempts: [], lastTransitionAt: 1000 },
    };

    const executor = new ExecutorEngine(mockInvoker, testBroker);
    const outcome = await executor.executeNodeAttempt(graph, scopelessNode, 0, 1, 'KEYED', 1000, 'sha256:policy-v1');

    expect(invoked).toBe(false);
    expect(outcome.errorCode).toBe('CREDENTIAL_SCOPE_REQUIRED');
  });

  it('refuses to invoke a scoped core/ACQUIRE node when no broker is configured', async () => {
    let invoked = false;
    const mockInvoker = {
      invoke: async () => {
        invoked = true;
        return { status: 'SUCCESS' as const };
      },
    };

    const executor = new ExecutorEngine(mockInvoker); // no broker
    const outcome = await executor.executeNodeAttempt(graph, node, 0, 1, 'KEYED', 1000, 'sha256:policy-v1');

    expect(invoked).toBe(false);
    expect(outcome.errorCode).toBe('BROKER_REQUIRED');
  });

  it('requires an explicit policySnapshotDigest (no fabricated default)', async () => {
    const executor = new ExecutorEngine({ invoke: async () => ({ status: 'SUCCESS' as const }) }, testBroker);
    await expect(
      executor.executeNodeAttempt(graph, node, 0, 1, 'KEYED', 1000, '' as string)
    ).rejects.toThrow(/policySnapshotDigest/);
  });
});
