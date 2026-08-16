import { KleeneBool, Predicate } from './attribute.js';
import { ContentRef, EpochMicros, NamespacedType, TypedValue } from './core.js';
import { Provenance } from './graph.js';

export interface DecisiveConstraint {
  code: string;
  predicate?: Predicate;
  evaluatedTruth?: KleeneBool;
  message: string;
}

export interface CandidateEvaluation {
  capabilityUid: string;
  targetAssertionUid: string;
  outcome: "SELECTED" | "REJECTED" | "INELIGIBLE";
  costMicros?: string; // Recorded candidate cost for offline cost rejection verification (§8.1)
  currency?: string;
  decisiveConstraint?: DecisiveConstraint;
}

export interface SelectedCapability {
  capabilityUid: string;
  targetAssertionUid: string;
  decisiveAttributes: Record<string, TypedValue>;
}

export interface AppliedRelaxation {
  policyRuleId: string;
  targetAssertionUid: string;
  justificationCode: string;
}

export interface ReadSetEntry {
  resourceUid: string;
  resourceType: string;
  version: string;
  validUntil: EpochMicros;
}

export interface WitnessedValue {
  attributeName: NamespacedType;
  subjectId: string;
  value?: TypedValue;           // Present only when isPersonalData === false (§13)
  valueRef?: ContentRef;        // Encrypted extent ref / HMAC commitment when isPersonalData === true (§13, §18.6)
  isPersonalData: boolean;
}

export interface DecisionRecord {
  apiVersion: "evidence.engine/v1alpha1";
  kind: "DecisionRecord";
  decisionDigest: string;
  goalDigest: string;
  contextIntegrityDigest: string;
  selectedCapabilities: SelectedCapability[];
  candidateEvaluations: CandidateEvaluation[];
  appliedRelaxations: AppliedRelaxation[];
  provenance: Provenance;
  readSet: ReadSetEntry[];
  witnessedValues: WitnessedValue[];
}
