import { DecisionRecord, EpochMicros, OperationalFactRef } from '../types/index.js';

export interface InvalidationResult {
  isInvalidated: boolean;
  reason?: string;
  invalidatedResourceUid?: string;
}

/**
 * Read-Set Invalidator (§11.2).
 * Determines if a graph revision's recorded decision read-set is stale.
 * A revision is stale iff a resource in its read-set:
 * 1. Has expired (planningInstant >= validUntil).
 * 2. Advanced in resource version.
 */
export class ReadSetInvalidator {
  public checkInvalidation(
    decisionRecord: DecisionRecord,
    latestOperationalFacts: OperationalFactRef[],
    currentInstant: EpochMicros
  ): InvalidationResult {
    for (const entry of decisionRecord.readSet) {
      // Check 1: Expiry
      if (currentInstant >= entry.validUntil) {
        return {
          isInvalidated: true,
          reason: `Resource "${entry.resourceUid}" expired: currentInstant (${currentInstant}) >= validUntil (${entry.validUntil})`,
          invalidatedResourceUid: entry.resourceUid,
        };
      }

      // Check 2: Monotonic resource version advancement
      const latestFact = latestOperationalFacts.find(f => f.capabilityUid === entry.resourceUid);
      if (latestFact && latestFact.version !== entry.version) {
        return {
          isInvalidated: true,
          reason: `Resource "${entry.resourceUid}" version advanced from "${entry.version}" to "${latestFact.version}"`,
          invalidatedResourceUid: entry.resourceUid,
        };
      }
    }

    return { isInvalidated: false };
  }
}
