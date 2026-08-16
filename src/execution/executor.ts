import { deriveNodeIdempotencyKey } from '../idempotency/key-generator.js';
import { CapabilityIdempotencySupport, classifyAttemptAcrossRevision } from './disposition.js';
import { CredentialBroker, CredentialToken } from '../security/credential-broker.js';
import {
  AttemptDisposition,
  EpochMicros,
  ExecutionGraph,
  GraphNode,
  NodeAttemptIntent,
  NodeAttemptOutcome,
} from '../types/index.js';

export interface ProviderInvoker {
  invoke(
    intent: NodeAttemptIntent,
    node: GraphNode
  ): Promise<{ status: 'SUCCESS' | 'FAILURE' | 'INDETERMINATE'; outputExtentRef?: string; errorCode?: string; errorMessage?: string }>;
}

export interface IndeterminateResolution {
  attemptUid: string;
  nodeUid: string;
  action: 'WITHHOLD_RETRY' | 'RETRY_NEW_ATTEMPT' | 'ABORT_GRAPH';
  reason: string;
}

/**
 * Executor Engine with Write-Ahead Intent Protocol & Credential Broker Enforcement (§11.4, §11.5, §11.7, AC-12).
 * Implements:
 * 1. Intent -> Invoke -> Outcome write-ahead logging protocol.
 * 2. Scoped Credential Broker token issuance and policy digest validation (§11.5).
 * 3. KEYED, NATURAL, NONE capability idempotency key support.
 * 4. IndeterminateResolution state machine for network partitions/timeouts.
 */
export class ExecutorEngine {
  private intentLog: NodeAttemptIntent[] = [];
  private outcomeLog: NodeAttemptOutcome[] = [];

  constructor(
    private invoker: ProviderInvoker,
    private broker?: CredentialBroker
  ) {}

  /**
   * Executes a node attempt following the Write-Ahead Intent Protocol (§11.4, §11.5).
   * Standing Convention: currentInstant MUST be provided explicitly as data. Zero clock defaults!
   */
  public async executeNodeAttempt(
    graph: ExecutionGraph,
    node: GraphNode,
    itemOrdinal: number | undefined,
    attemptOrdinal: number,
    idempotencySupport: CapabilityIdempotencySupport,
    currentInstant: EpochMicros,
    policySnapshotDigest: string
  ): Promise<NodeAttemptOutcome> {
    if (!currentInstant) {
      throw new Error('executeNodeAttempt requires an explicit currentInstant parameter.');
    }
    // A fabricated default digest would be compared against itself in validateToken,
    // silently defeating the policy binding that §11.5 exists to provide.
    if (!policySnapshotDigest) {
      throw new Error('executeNodeAttempt requires an explicit policySnapshotDigest parameter.');
    }

    const investigationUid = graph.investigationUid || graph.graphUid;

    // 1. Derive idempotency key based on capability support level (§11.4)
    let idempotencyKey = '';
    let idempotencyDigest = '';

    if (idempotencySupport === 'KEYED') {
      const derived = deriveNodeIdempotencyKey(investigationUid, node, itemOrdinal, attemptOrdinal);
      idempotencyKey = derived.idempotencyKey;
      idempotencyDigest = derived.idempotencyDigest;
    } else if (idempotencySupport === 'NATURAL') {
      idempotencyKey = `nat-${node.uid}-${itemOrdinal || 0}`;
      idempotencyDigest = `sha256:natural-${node.uid}`;
    } else {
      idempotencyKey = 'none';
      idempotencyDigest = 'sha256:none';
    }

    const attemptUid = `att-${node.uid}-${attemptOrdinal}-${currentInstant}`;

    // 2. Obtain and validate Scoped Credential Token (§11.5)
    //
    // Enforcement keys off the node KIND, never off the presence of the field being
    // enforced. Gating on `node.spec.credentialScope` would make a missing scope the
    // bypass rather than the refusal.
    let credentialToken: CredentialToken | undefined;
    if (node.kind === 'core/ACQUIRE') {
      if (!node.spec.credentialScope) {
        const outcome: NodeAttemptOutcome = {
          attemptUid,
          nodeUid: node.uid,
          disposition: 'QUIESCED',
          status: 'INDETERMINATE',
          completedAt: currentInstant,
          errorCode: 'CREDENTIAL_SCOPE_REQUIRED',
          errorMessage: `Node "${node.uid}" is a core/ACQUIRE node with no CredentialScope. Every acquiring node MUST carry one (§11.5). Invocation refused.`,
        };
        this.outcomeLog.push(outcome);
        return outcome;
      }

      if (!this.broker) {
        const outcome: NodeAttemptOutcome = {
          attemptUid,
          nodeUid: node.uid,
          disposition: 'QUIESCED',
          status: 'INDETERMINATE',
          completedAt: currentInstant,
          errorCode: 'BROKER_REQUIRED',
          errorMessage: `Node "${node.uid}" requires a scoped credential, but ExecutorEngine has no CredentialBroker configured. Invocation refused under §11.5.`,
        };
        this.outcomeLog.push(outcome);
        return outcome;
      }

      try {
        credentialToken = this.broker.issueScopedCredential(node, policySnapshotDigest, currentInstant);
        this.broker.validateToken(credentialToken, policySnapshotDigest, currentInstant);
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        const outcome: NodeAttemptOutcome = {
          attemptUid,
          nodeUid: node.uid,
          disposition: 'QUIESCED',
          status: 'INDETERMINATE',
          completedAt: currentInstant,
          errorCode: 'CREDENTIAL_ISSUANCE_FAILED',
          errorMessage: errorMsg,
        };
        this.outcomeLog.push(outcome);
        return outcome;
      }
    }

    // 3. WRITE-AHEAD: Record intent BEFORE calling external provider
    const intent: NodeAttemptIntent = {
      attemptUid,
      nodeUid: node.uid,
      revision: 1,
      idempotencyKey,
      idempotencyDigest,
      attemptOrdinal,
      dispatchedAt: currentInstant,
    };
    if (itemOrdinal !== undefined) {
      intent.itemOrdinal = itemOrdinal;
    }
    if (credentialToken) {
      intent.credentialToken = credentialToken;
    }
    this.intentLog.push(intent);

    // 4. Check disposition if graph replan occurred
    const classification = classifyAttemptAcrossRevision(intent, graph, idempotencySupport);
    if (classification.disposition === 'QUIESCED') {
      const outcome: NodeAttemptOutcome = {
        attemptUid,
        nodeUid: node.uid,
        disposition: 'QUIESCED',
        status: 'INDETERMINATE',
        completedAt: currentInstant,
        errorMessage: classification.reason,
      };
      this.outcomeLog.push(outcome);
      return outcome;
    }

    // 5. INVOKE external provider with credential token attached (§11.5)
    try {
      const response = await this.invoker.invoke(intent, node);

      const outcome: NodeAttemptOutcome = {
        attemptUid,
        nodeUid: node.uid,
        disposition: classification.disposition,
        status: response.status,
        completedAt: currentInstant,
      };
      if (response.outputExtentRef) outcome.outputExtentRef = response.outputExtentRef;
      if (response.errorCode) outcome.errorCode = response.errorCode;
      if (response.errorMessage) outcome.errorMessage = response.errorMessage;

      this.outcomeLog.push(outcome);
      return outcome;
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);

      // Handle IndeterminateResolution (§11.7)
      const outcome: NodeAttemptOutcome = {
        attemptUid,
        nodeUid: node.uid,
        disposition: classification.disposition,
        status: 'INDETERMINATE',
        completedAt: currentInstant,
        errorCode: 'NETWORK_INDETERMINATE',
        errorMessage: errorMsg,
      };

      this.outcomeLog.push(outcome);
      return outcome;
    }
  }

  /**
   * Resolves an INDETERMINATE attempt outcome under §11.7 rule set.
   */
  public resolveIndeterminate(
    outcome: NodeAttemptOutcome,
    idempotencySupport: CapabilityIdempotencySupport
  ): IndeterminateResolution {
    if (idempotencySupport === 'NONE') {
      return {
        attemptUid: outcome.attemptUid,
        nodeUid: outcome.nodeUid,
        action: 'WITHHOLD_RETRY',
        reason: 'Capability does not support idempotency keys (NONE). Retry withheld to prevent duplicate side effects.',
      };
    }

    return {
      attemptUid: outcome.attemptUid,
      nodeUid: outcome.nodeUid,
      action: 'RETRY_NEW_ATTEMPT',
      reason: `Capability supports ${idempotencySupport} idempotency keys. Safe to retry with incremented attemptOrdinal.`,
    };
  }

  public getIntentLog(): NodeAttemptIntent[] {
    return this.intentLog;
  }

  public getOutcomeLog(): NodeAttemptOutcome[] {
    return this.outcomeLog;
  }
}
