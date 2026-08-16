import { canonicalDigest } from '../canonical/jcs.js';
import { evaluatePredicate } from '../predicate/evaluator.js';
import { parseAmountMicros } from '../canonical/money.js';
import { SchemaRegistry } from '../registry/attribute-registry.js';
import { DecisionRecord, TypedValue } from '../types/index.js';

export interface VerificationResult {
  valid: boolean;
  computedDigest: string;
  recordedDigest: string;
  predicateVerificationFailures: string[];
  errors: string[];
}

/**
 * Offline Decision Record Verifier (§8.1, AC-31).
 * Re-evaluates recorded predicates, candidate constraints, and witnessed values
 * without querying live state or databases ("Verify rather than recompute").
 *
 * Supports optional decryptedWitnessValues for personal data extent verification.
 */
export function verifyDecisionRecord(
  record: DecisionRecord,
  registry?: SchemaRegistry,
  decryptedWitnessValues?: Map<string, Record<string, TypedValue>> | Record<string, Record<string, TypedValue>>
): VerificationResult {
  const errors: string[] = [];
  const predicateVerificationFailures: string[] = [];

  // 1. Re-compute decision digest over canonical decision record object (Tamper Check)
  const recordCopy = { ...record, decisionDigest: '' };
  const computedDigest = canonicalDigest(recordCopy);

  if (record.decisionDigest !== computedDigest) {
    errors.push(
      `Decision digest mismatch: recorded "${record.decisionDigest}", computed "${computedDigest}"`
    );
  }

  // 2. Validate read-set entries structure
  for (const entry of record.readSet) {
    if (!entry.resourceUid || !entry.version || !entry.validUntil) {
      errors.push(`Invalid readSet entry: missing resourceUid, version, or validUntil`);
    }
  }

  // 3. Re-evaluate candidate evaluations against witnessed values (AC-31)
  const witnessedBySubject = new Map<string, Record<string, TypedValue>>();

  // Normalize decrypted witness map if provided
  const decryptedMap = decryptedWitnessValues instanceof Map
    ? decryptedWitnessValues
    : decryptedWitnessValues ? new Map(Object.entries(decryptedWitnessValues)) : undefined;

  for (const wit of record.witnessedValues) {
    let map = witnessedBySubject.get(wit.subjectId);
    if (!map) {
      map = {};
      witnessedBySubject.set(wit.subjectId, map);
    }

    if (wit.value) {
      map[wit.attributeName] = wit.value;
    } else if (wit.valueRef) {
      // Validate valueRef structure
      if (!wit.valueRef.digest || !wit.valueRef.mediaType) {
        errors.push(`Invalid witnessedValueRef for attribute "${wit.attributeName}" on subject "${wit.subjectId}"`);
      }
      // Look up in decrypted witness values if provided
      const decryptedSubject = decryptedMap?.get(wit.subjectId);
      const decryptedVal = decryptedSubject ? decryptedSubject[wit.attributeName] : undefined;
      if (decryptedVal) {
        map[wit.attributeName] = decryptedVal;
      }
    }
  }

  if (record.candidateEvaluations.length === 0) {
    errors.push(`Decision record has empty candidateEvaluations`);
  }

  for (const evalItem of record.candidateEvaluations) {
    let witnessedAttrs = witnessedBySubject.get(evalItem.targetAssertionUid);
    if (!witnessedAttrs) {
      witnessedAttrs = {};
      for (const map of witnessedBySubject.values()) {
        Object.assign(witnessedAttrs, map);
      }
    }

    if (evalItem.decisiveConstraint?.predicate) {
      const pred = evalItem.decisiveConstraint.predicate;
      const reevaluatedTruth = evaluatePredicate(pred, witnessedAttrs, registry);

      // Exact truth equality requirement (Point #1 Fix)
      if (reevaluatedTruth !== evalItem.decisiveConstraint.evaluatedTruth) {
        predicateVerificationFailures.push(
          `Re-evaluation mismatch for candidate "${evalItem.capabilityUid}" on assertion "${evalItem.targetAssertionUid}": recorded evaluatedTruth "${evalItem.decisiveConstraint.evaluatedTruth}", recomputed "${reevaluatedTruth}"`
        );
      }
    } else if (evalItem.outcome === 'REJECTED' && evalItem.decisiveConstraint?.code === 'OUT_COMPETED_ON_COST') {
      // Re-verify cost rejection against selected candidate cost (§8.1)
      const selectedEval = record.candidateEvaluations.find(
        e => e.targetAssertionUid === evalItem.targetAssertionUid && e.outcome === 'SELECTED'
      );
      if (selectedEval && selectedEval.costMicros && evalItem.costMicros) {
        const selectedCost = parseAmountMicros(selectedEval.costMicros);
        const rejectedCost = parseAmountMicros(evalItem.costMicros);
        if (rejectedCost < selectedCost) {
          predicateVerificationFailures.push(
            `Cost verification failure for candidate "${evalItem.capabilityUid}" on assertion "${evalItem.targetAssertionUid}": rejected candidate cost (${evalItem.costMicros}) was lower than selected candidate cost (${selectedEval.costMicros})`
          );
        }
      }
    }
  }

  const valid = errors.length === 0 && predicateVerificationFailures.length === 0;

  return {
    valid,
    computedDigest,
    recordedDigest: record.decisionDigest,
    predicateVerificationFailures,
    errors,
  };
}
