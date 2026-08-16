import { ContentRef, EpochMicros } from './core.js';

export interface SnapshotRef {
  digest: string;
  schemaVersion: string;
}

export interface BundleRef {
  digest: string;
  version: string;
}

export interface GoalSpecRef {
  digest: string;
}

export interface PlanningContextRef {
  digest: string;
}

export interface OperationalFactRef {
  capabilityUid: string;
  version: string;
  observedAt: EpochMicros;
  validUntil: EpochMicros;
}

export interface StateFactRef {
  address: string;
  version: string;
  observedAt: EpochMicros;
  validUntil: EpochMicros;
  valueRef: ContentRef;
}

export interface PlanningContext {
  capabilitySnapshot: SnapshotRef;
  policySnapshot: SnapshotRef;
  exchangeRateSnapshot?: SnapshotRef;
  strategyBundle: BundleRef;
  operationalFacts: OperationalFactRef[];
  stateFacts: StateFactRef[];
  planningInstant: EpochMicros;
  integrityDigest: string;
  subjectKeys?: Record<string, Buffer> | Map<string, Buffer>; // Pre-provisioned secret subject keys derived from HKDF(tenantKeyRing, subjectSalt) (§13, §18.6, AC-28)
}

export interface CompileRequest {
  investigationUid?: string;
  goal: GoalSpecRef;
  context: PlanningContextRef;
  traceLevel: "NONE" | "SUMMARY" | "VERBOSE_AUDIT";
}
