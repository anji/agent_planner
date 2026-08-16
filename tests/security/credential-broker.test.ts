import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CredentialBroker } from '../../src/security/credential-broker.js';
import { GraphNode } from '../../src/types/index.js';

describe('Scoped Credential Broker (§11.5 & Standing Security Convention)', () => {
  const secretKey = randomBytes(32);
  const broker = new CredentialBroker(secretKey);

  const nodeWithScope: GraphNode = {
    uid: 'node-101',
    kind: 'core/ACQUIRE',
    spec: {
      capabilityUid: 'provider-kyb-v1',
      credentialScope: {
        scopeId: 'scope-fintech-regulated',
        allowedCapabilities: ['provider-kyb-v1', 'provider-pep-v1'],
        maxBudgetMicros: '1000000',
      },
    },
    dataFlow: { inputBindings: {} },
    status: { phase: 'PENDING', attempts: [], lastTransitionAt: 1000 },
  };

  const policyDigest = 'sha256:pol-digest-v1';

  it('enforces Standing Security Convention: zero-arg construction or key < 32 bytes throws MISSING_BROKER_SECRET', () => {
    // @ts-expect-error Zero-arg call
    expect(() => new CredentialBroker()).toThrow(/MISSING_BROKER_SECRET/);
    expect(() => new CredentialBroker(Buffer.from('short-key'))).toThrow(/MISSING_BROKER_SECRET/);
  });

  it('issues cryptographically signed CredentialToken bound to policy digest (§11.5)', () => {
    const token = broker.issueScopedCredential(nodeWithScope, policyDigest, 1000);

    expect(token.scopeId).toBe('scope-fintech-regulated');
    expect(token.policySnapshotDigest).toBe(policyDigest);
    expect(token.signature).toMatch(/^sha256:[a-f0-9]{64}$/);

    const isValid = broker.validateToken(token, policyDigest, 1000);
    expect(isValid).toBe(true);
  });

  it('rejects forged tokens signed with an un-owned secret key', () => {
    const attackerKey = randomBytes(32);
    const attackerBroker = new CredentialBroker(attackerKey);

    // Attacker mints an admin-scope token for cap-restricted-pii
    const forgedNode: GraphNode = {
      uid: 'node-admin-forged',
      kind: 'core/ACQUIRE',
      spec: {
        capabilityUid: 'cap-restricted-pii',
        credentialScope: { scopeId: 'scope-admin', allowedCapabilities: ['cap-restricted-pii'] },
      },
      dataFlow: { inputBindings: {} },
      status: { phase: 'PENDING', attempts: [], lastTransitionAt: 1000 },
    };

    const forgedToken = attackerBroker.issueScopedCredential(forgedNode, policyDigest, 1000);

    // Legitimate broker MUST reject the forged token
    expect(() => broker.validateToken(forgedToken, policyDigest, 1000)).toThrow(/INVALID_SIGNATURE/);
  });

  it('rejects credential issuance when capability is not allowed in scope', () => {
    const unpermittedNode: GraphNode = {
      ...nodeWithScope,
      spec: {
        ...nodeWithScope.spec,
        capabilityUid: 'provider-unauthorized-v9',
      },
    };

    expect(() => broker.issueScopedCredential(unpermittedNode, policyDigest, 1000)).toThrow(
      /CAPABILITY_NOT_PERMITTED_IN_SCOPE/
    );
  });

  it('rejects token validation when policy digest mismatches', () => {
    const token = broker.issueScopedCredential(nodeWithScope, policyDigest, 1000);

    expect(() => broker.validateToken(token, 'sha256:different-policy-digest', 1000)).toThrow(
      /POLICY_DIGEST_MISMATCH/
    );
  });
});
