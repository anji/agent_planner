import { AttemptDisposition, ExecutionGraph, NodeAttemptIntent } from '../types/index.js';
import { deriveNodeIdempotencyKey } from '../idempotency/key-generator.js';

export type CapabilityIdempotencySupport = 'KEYED' | 'NATURAL' | 'NONE';

export interface ClassificationResult {
  attemptUid: string;
  disposition: AttemptDisposition;
  reason: string;
}

/**
 * Classifies an in-flight attempt when a new graph revision publishes (§11.7).
 *
 * Rules:
 * - CARRIED: Same node UID + itemOrdinal + idempotencyDigest exist in new revision.
 * - ORPHANED: Node absent in new revision, or idempotencyDigest changed. Cost accounted, INADMISSIBLE as evidence in new revision.
 * - QUIESCED: Capability declares idempotencySupport: "NONE", dispatch withheld while replan pending.
 */
export function classifyAttemptAcrossRevision(
  intent: NodeAttemptIntent,
  newGraph: ExecutionGraph,
  idempotencySupport: CapabilityIdempotencySupport = 'KEYED'
): ClassificationResult {
  if (idempotencySupport === 'NONE') {
    return {
      attemptUid: intent.attemptUid,
      disposition: 'QUIESCED',
      reason: 'Capability does not support idempotency keys (NONE); dispatch withheld during replan.',
    };
  }

  const newTargetNode = newGraph.nodes.find(n => n.uid === intent.nodeUid);
  if (!newTargetNode) {
    return {
      attemptUid: intent.attemptUid,
      disposition: 'ORPHANED',
      reason: `Node "${intent.nodeUid}" is absent in new graph revision.`,
    };
  }

  const { idempotencyDigest: newDigest } = deriveNodeIdempotencyKey(
    newGraph.investigationUid || newGraph.graphUid,
    newTargetNode,
    intent.itemOrdinal,
    intent.attemptOrdinal || 1
  );

  if (newDigest === intent.idempotencyDigest) {
    return {
      attemptUid: intent.attemptUid,
      disposition: 'CARRIED',
      reason: 'Node and idempotency digest match across graph revision; outcome applies to new revision.',
    };
  }

  return {
    attemptUid: intent.attemptUid,
    disposition: 'ORPHANED',
    reason: `Idempotency digest changed from "${intent.idempotencyDigest}" to "${newDigest}".`,
  };
}
