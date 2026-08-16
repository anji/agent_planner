import { createHmac } from 'node:crypto';
import { CredentialScope, EpochMicros, GraphNode } from '../types/index.js';
import { canonicalizeJson } from '../canonical/jcs.js';

export interface CredentialToken {
  tokenId: string;
  scopeId: string;
  policySnapshotDigest: string;
  nodeUid: string;
  capabilityUid: string;
  issuedAt: EpochMicros;
  expiresAt: EpochMicros;
  signature: string;
}

export class CredentialBrokerError extends Error {
  public code: string;
  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.code = code;
  }
}

/**
 * Scoped Credential Broker (§11.5).
 * Validates CredentialScope against policySnapshotDigest and issues
 * short-lived cryptographically signed tokens for provider invocations.
 *
 * Standing Convention: Constructor MUST receive an explicit secret key (>= 32 bytes). Zero defaults!
 */
export class CredentialBroker {
  constructor(private brokerSecretKey: Buffer) {
    if (!brokerSecretKey || brokerSecretKey.length < 32) {
      throw new CredentialBrokerError(
        'MISSING_BROKER_SECRET',
        'CredentialBroker requires a minimum 32-byte secret key. Zero defaults permitted under security policy.'
      );
    }
  }

  /**
   * Validates a node's CredentialScope against policySnapshotDigest and issues a CredentialToken (§11.5).
   */
  public issueScopedCredential(
    node: GraphNode,
    policySnapshotDigest: string,
    currentInstant: EpochMicros
  ): CredentialToken {
    if (!currentInstant) {
      throw new CredentialBrokerError(
        'MISSING_TIMESTAMP',
        'issueScopedCredential requires an explicit currentInstant parameter.'
      );
    }

    const scope = node.spec.credentialScope;
    if (!scope) {
      throw new CredentialBrokerError(
        'MISSING_CREDENTIAL_SCOPE',
        `Node "${node.uid}" has no CredentialScope defined in spec; credential issuance rejected.`
      );
    }

    if (!node.spec.capabilityUid) {
      throw new CredentialBrokerError(
        'MISSING_CAPABILITY_UID',
        `Node "${node.uid}" has no capabilityUid defined; credential issuance rejected.`
      );
    }

    if (scope.allowedCapabilities && !scope.allowedCapabilities.includes(node.spec.capabilityUid)) {
      throw new CredentialBrokerError(
        'CAPABILITY_NOT_PERMITTED_IN_SCOPE',
        `Capability "${node.spec.capabilityUid}" is not permitted under CredentialScope "${scope.scopeId}".`
      );
    }

    const issuedAt = currentInstant;
    const expiresAt = currentInstant + 300 * 1000 * 1000; // 5-minute TTL

    const payload = {
      scopeId: scope.scopeId,
      policySnapshotDigest,
      nodeUid: node.uid,
      capabilityUid: node.spec.capabilityUid,
      issuedAt,
      expiresAt,
    };

    const payloadJson = canonicalizeJson(payload);
    const hmac = createHmac('sha256', this.brokerSecretKey);
    hmac.update(payloadJson);
    const signature = `sha256:${hmac.digest('hex')}`;
    const tokenId = `cred-${signature.substring(7, 23)}`;

    return {
      tokenId,
      scopeId: scope.scopeId,
      policySnapshotDigest,
      nodeUid: node.uid,
      capabilityUid: node.spec.capabilityUid,
      issuedAt,
      expiresAt,
      signature,
    };
  }

  /**
   * Validates an issued CredentialToken against current policy digest and expiration.
   */
  public validateToken(
    token: CredentialToken,
    expectedPolicyDigest: string,
    currentInstant: EpochMicros
  ): boolean {
    if (!currentInstant) {
      throw new CredentialBrokerError(
        'MISSING_TIMESTAMP',
        'validateToken requires an explicit currentInstant parameter.'
      );
    }

    if (token.expiresAt <= currentInstant) {
      throw new CredentialBrokerError('CREDENTIAL_EXPIRED', `CredentialToken "${token.tokenId}" has expired.`);
    }

    if (token.policySnapshotDigest !== expectedPolicyDigest) {
      throw new CredentialBrokerError(
        'POLICY_DIGEST_MISMATCH',
        `CredentialToken policy digest "${token.policySnapshotDigest}" does not match current graph policy digest "${expectedPolicyDigest}".`
      );
    }

    const payload = {
      scopeId: token.scopeId,
      policySnapshotDigest: token.policySnapshotDigest,
      nodeUid: token.nodeUid,
      capabilityUid: token.capabilityUid,
      issuedAt: token.issuedAt,
      expiresAt: token.expiresAt,
    };

    const payloadJson = canonicalizeJson(payload);
    const hmac = createHmac('sha256', this.brokerSecretKey);
    hmac.update(payloadJson);
    const expectedSig = `sha256:${hmac.digest('hex')}`;

    if (token.signature !== expectedSig) {
      throw new CredentialBrokerError('INVALID_SIGNATURE', `CredentialToken "${token.tokenId}" signature is invalid.`);
    }

    return true;
  }
}
