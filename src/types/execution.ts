import { EpochMicros } from './core.js';
import { KleeneBool } from './attribute.js';
import { CredentialToken } from '../security/credential-broker.js';

export type NodePhase = 'PENDING' | 'DISPATCHED' | 'FAILED' | 'SUCCEEDED' | 'CANCELLED';

export type AttemptDisposition = 'CARRIED' | 'ORPHANED' | 'QUIESCED';

export interface NodeAttemptIntent {
  attemptUid: string;
  nodeUid: string;
  revision: number;
  idempotencyKey: string;
  idempotencyDigest: string;
  credentialToken?: CredentialToken;
  itemOrdinal?: number;
  attemptOrdinal: number; // Required for exact retry classification (§11.4, §11.7)
  dispatchedAt: EpochMicros;
}

export interface NodeAttemptOutcome {
  attemptUid: string;
  nodeUid: string;
  disposition: AttemptDisposition;
  status: 'SUCCESS' | 'SUCCEEDED' | 'FAILURE' | 'FAILED' | 'INDETERMINATE';
  completedAt: EpochMicros;
  outputExtentRef?: string;
  errorCode?: string;
  errorMessage?: string;
}

export interface NodeStatus {
  phase: NodePhase;
  attempts: NodeAttemptIntent[];
  activeAttemptUid?: string;
  lastTransitionAt: EpochMicros;
  conditionValue?: KleeneBool;
}
