import { describe, expect, it } from 'vitest';
import { deriveNodeIdempotencyKey } from '../../src/idempotency/key-generator.ts';
import { classifyAttemptAcrossRevision } from '../../src/execution/disposition.ts';
import { ExecutionGraph, GraphNode, NodeAttemptIntent } from '../../src/types/index.ts';

describe('Idempotency Key Derivation & Attempt Disposition State Machine', () => {
  const node: GraphNode = {
    uid: 'node-1',
    kind: 'core/ACQUIRE',
    spec: {
      capabilityUid: 'cap-check-v1',
      requestTemplate: { type: 'core/string', value: 'query-123' },
    },
    dataFlow: { inputBindings: {} },
    status: { phase: 'PENDING', attempts: [], lastTransitionAt: 100000 },
  };

  it('derives stable idempotency keys incorporating investigationUid and attemptOrdinal to prevent collisions', () => {
    const res1 = deriveNodeIdempotencyKey('inv-100', node, undefined, 1);
    const res2 = deriveNodeIdempotencyKey('inv-100', node, undefined, 1);
    const resDifferentInv = deriveNodeIdempotencyKey('inv-200', node, undefined, 1);

    expect(res1.idempotencyKey).toBe(res2.idempotencyKey);
    expect(res1.idempotencyDigest).toBe(res2.idempotencyDigest);
    // Unique across different investigations!
    expect(res1.idempotencyKey).not.toBe(resDifferentInv.idempotencyKey);
  });

  it('classifies attempt as CARRIED when node and digest match in revision N+1', () => {
    const { idempotencyKey, idempotencyDigest } = deriveNodeIdempotencyKey('graph-2', node, undefined, 1);

    const intent: NodeAttemptIntent = {
      attemptUid: 'att-100',
      nodeUid: 'node-1',
      revision: 1,
      idempotencyKey,
      idempotencyDigest,
      dispatchedAt: 100000,
    };

    const newGraph: ExecutionGraph = {
      graphUid: 'graph-2',
      metadata: { tenant: 't1', createdAt: 200000 },
      provenance: { compilerVersion: '0.1.0', solverAlgorithm: 'v1', bundleDigest: 'd', timestamp: 200000 },
      nodes: [node],
      edges: [],
      status: 'READY',
      unmetAssertions: [],
      decisionRecordRef: { digest: 'd', mediaType: 'app/json', sizeBytes: 10 },
    };

    const result = classifyAttemptAcrossRevision(intent, newGraph, 'KEYED');
    expect(result.disposition).toBe('CARRIED');
  });

  it('classifies attempt as ORPHANED when node payload changes in revision N+1', () => {
    const { idempotencyKey, idempotencyDigest } = deriveNodeIdempotencyKey('graph-3', node, undefined, 1);

    const intent: NodeAttemptIntent = {
      attemptUid: 'att-101',
      nodeUid: 'node-1',
      revision: 1,
      idempotencyKey,
      idempotencyDigest,
      dispatchedAt: 100000,
    };

    const modifiedNode: GraphNode = {
      ...node,
      spec: {
        ...node.spec,
        requestTemplate: { type: 'core/string', value: 'MODIFIED_QUERY' },
      },
    };

    const newGraph: ExecutionGraph = {
      graphUid: 'graph-3',
      metadata: { tenant: 't1', createdAt: 200000 },
      provenance: { compilerVersion: '0.1.0', solverAlgorithm: 'v1', bundleDigest: 'd', timestamp: 200000 },
      nodes: [modifiedNode],
      edges: [],
      status: 'READY',
      unmetAssertions: [],
      decisionRecordRef: { digest: 'd', mediaType: 'app/json', sizeBytes: 10 },
    };

    const result = classifyAttemptAcrossRevision(intent, newGraph, 'KEYED');
    expect(result.disposition).toBe('ORPHANED');
  });

  it('classifies attempt as QUIESCED if capability does not support idempotency keys (NONE)', () => {
    const { idempotencyKey, idempotencyDigest } = deriveNodeIdempotencyKey('graph-4', node, undefined, 1);

    const intent: NodeAttemptIntent = {
      attemptUid: 'att-102',
      nodeUid: 'node-1',
      revision: 1,
      idempotencyKey,
      idempotencyDigest,
      dispatchedAt: 100000,
    };

    const emptyGraph: ExecutionGraph = {
      graphUid: 'graph-4',
      metadata: { tenant: 't1', createdAt: 200000 },
      provenance: { compilerVersion: '0.1.0', solverAlgorithm: 'v1', bundleDigest: 'd', timestamp: 200000 },
      nodes: [],
      edges: [],
      status: 'READY',
      unmetAssertions: [],
      decisionRecordRef: { digest: 'd', mediaType: 'app/json', sizeBytes: 10 },
    };

    const result = classifyAttemptAcrossRevision(intent, emptyGraph, 'NONE');
    expect(result.disposition).toBe('QUIESCED');
  });
});
