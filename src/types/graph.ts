import { ContentRef, CredentialScope, EpochMicros, TypedValue } from './core.js';
import { KleeneBool } from './attribute.js';
import { NodeStatus } from './execution.js';

export interface Binding {
  source?: 'STATE' | 'NODE_OUTPUT';
  role?: string;
  sourceNodeUid?: string;
  path?: string;
}

export interface Condition {
  all?: Condition[];
  any?: Condition[];
  not?: Condition;
  defined?: Binding;
  compare?: {
    op: string;
    left: Binding;
    right: TypedValue | Binding;
  };
}

export interface NodeSpec {
  capabilityUid?: string;
  transformType?: string;
  requestTemplate?: TypedValue;
  credentialScope?: CredentialScope;
  condition?: Condition;
}

export interface NodeDataFlow {
  inputBindings: Record<string, Binding>;
}

export interface GraphNode {
  uid: string;
  kind: 'core/ACQUIRE' | 'core/TRANSFORM' | 'core/GATE' | 'core/FAN_OUT';
  spec: NodeSpec;
  dataFlow: NodeDataFlow;
  status: NodeStatus;
}

export interface Provenance {
  compilerVersion: string;
  solverAlgorithm: string;
  bundleDigest: string;
  timestamp: EpochMicros;
}

export type GraphStatus =
  | 'READY'
  | 'PARTIAL'
  | 'UNSATISFIABLE'
  | 'AWAITING_REQUIRED_STATE'
  | 'INDETERMINATE_UNDER_APPROXIMATION';

export interface UnmetAssertion {
  assertionUid: string;
  reasonCode: string;
  message: string;
}

export interface GraphEdge {
  fromNodeUid: string;
  toNodeUid: string;
  bindingRole: string;
}

export interface ExecutionGraph {
  graphUid: string;
  investigationUid: string; // Unique investigation lifecycle UID (§11.4, §18.2)
  metadata: Record<string, unknown>;
  provenance: Provenance;
  nodes: GraphNode[];
  edges: GraphEdge[];
  status: GraphStatus;
  unmetAssertions: UnmetAssertion[];
  decisionRecordRef: ContentRef;
}
