import { describe, expect, it } from 'vitest';
import { AdvanceLoop } from '../../src/reconciliation/advance-loop.js';
import { ExecutionGraph, GraphNode } from '../../src/types/index.js';

describe('Hot Advance Loop (Pure Graph Evaluation)', () => {
  const advanceLoop = new AdvanceLoop();

  it('evaluates pending conditions and transitions nodes to DISPATCHED without calling compiler', () => {
    const node1: GraphNode = {
      uid: 'node-1',
      kind: 'core/ACQUIRE',
      spec: { capabilityUid: 'cap-1' },
      dataFlow: { inputBindings: {} },
      status: { phase: 'PENDING', attempts: [], lastTransitionAt: 1000 },
    };

    const graph: ExecutionGraph = {
      graphUid: 'g-1',
      metadata: { tenant: 't1', createdAt: 1000 },
      provenance: { compilerVersion: '0.1.0', solverAlgorithm: 'v1', bundleDigest: 'd', timestamp: 1000 },
      nodes: [node1],
      edges: [],
      status: 'PARTIAL',
      unmetAssertions: [],
      decisionRecordRef: { digest: 'd', mediaType: 'app/json', sizeBytes: 10 },
    };

    const result = advanceLoop.advance(graph, {}, {}, [], 2000);

    expect(result.newlyDispatchedNodes.length).toBe(1);
    expect(result.graph.nodes[0]?.status.phase).toBe('DISPATCHED');
    expect(result.transitions.length).toBeGreaterThan(0);
  });

  it('processes incoming attempt outcomes and updates node status phase to SUCCEEDED', () => {
    const node1: GraphNode = {
      uid: 'node-10',
      kind: 'core/ACQUIRE',
      spec: { capabilityUid: 'cap-10' },
      dataFlow: { inputBindings: {} },
      status: { phase: 'DISPATCHED', attempts: [], lastTransitionAt: 1000 },
    };

    const graph: ExecutionGraph = {
      graphUid: 'g-2',
      metadata: { tenant: 't1', createdAt: 1000 },
      provenance: { compilerVersion: '0.1.0', solverAlgorithm: 'v1', bundleDigest: 'd', timestamp: 1000 },
      nodes: [node1],
      edges: [],
      status: 'PARTIAL',
      unmetAssertions: [],
      decisionRecordRef: { digest: 'd', mediaType: 'app/json', sizeBytes: 10 },
    };

    const outcome = {
      attemptUid: 'att-10',
      nodeUid: 'node-10',
      status: 'SUCCEEDED' as const,
      completedAt: 2500,
    };

    const result = advanceLoop.advance(graph, {}, {}, [outcome], 2500);

    expect(result.graph.nodes[0]?.status.phase).toBe('SUCCEEDED');
    expect(result.graph.status).toBe('READY');
  });
});
