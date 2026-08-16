import { canonicalDigest } from '../canonical/jcs.js';
import { GraphNode } from '../types/index.js';

export interface IdempotencyKeyResult {
  idempotencyKey: string;
  idempotencyDigest: string;
}

/**
 * Derives idempotency key and digest for a node (§11.4).
 * Formula: ik-<digest> where digest = H(investigationUid || nodeUid || itemOrdinal || idempotencyDigest || attemptOrdinal)
 * Enforces Invariant 5:
 * 1. Derived in graph, not executor.
 * 2. Excludes graph revision.
 * 3. Incorporates investigationUid to prevent cross-investigation key collisions (§18.2).
 * 4. Incorporates attemptOrdinal so retries are distinguishable from duplicates.
 * 5. Digests only idempotencyRelevant fields (defaults to true).
 */
export function deriveNodeIdempotencyKey(
  investigationUid: string,
  node: GraphNode,
  itemOrdinal?: number,
  attemptOrdinal = 1,
  idempotencyRelevantProjection?: Record<string, unknown>
): IdempotencyKeyResult {
  const spec = node.spec;

  // Filter or construct idempotency-relevant payload
  const projection = idempotencyRelevantProjection ?? {
    capabilityUid: spec.capabilityUid,
    transformType: spec.transformType,
    requestTemplate: spec.requestTemplate,
    credentialScope: spec.credentialScope,
  };

  const payload = {
    investigationUid,
    nodeUid: node.uid,
    nodeKind: node.kind,
    itemOrdinal: itemOrdinal ?? null,
    attemptOrdinal,
    projection,
  };

  const digest = canonicalDigest(payload);
  const key = `ik-${node.uid}-${itemOrdinal !== undefined ? `ord${itemOrdinal}-` : ''}att${attemptOrdinal}-${digest.substring(7, 23)}`;

  return {
    idempotencyKey: key,
    idempotencyDigest: digest,
  };
}
