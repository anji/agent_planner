import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createKeyedPersonalCommitment, CryptoShreddedStore, SubjectSaltStore } from '../../src/storage/crypto-shredded-store.ts';

describe('Crypto-Shredded Evidence Storage & Erasure Boundary', () => {
  const tenantMasterKeyRing = randomBytes(32);

  it('encrypts and decrypts evidence for a subject using AES-256-GCM', () => {
    const saltStore = new SubjectSaltStore();
    const store = new CryptoShreddedStore(tenantMasterKeyRing, saltStore);

    const subjectId = 'subj-person-999';
    const evidenceText = 'Confidential Evidence: Jane Doe SSN 000-11-2222';

    const extent = store.encryptEvidence(subjectId, evidenceText);
    expect(extent.subjectId).toBe(subjectId);
    expect(extent.ciphertextHex).not.toContain('Jane Doe');

    const decrypted = store.decryptEvidence(extent);
    expect(decrypted.toString('utf8')).toBe(evidenceText);
  });

  it('verifies erasure holds after subject salt destruction (AC-28)', () => {
    const saltStore = new SubjectSaltStore();
    const store = new CryptoShreddedStore(tenantMasterKeyRing, saltStore);

    const subjectId = 'subj-erased-404';
    const evidenceText = 'Personal Health Record Data';

    const extent = store.encryptEvidence(subjectId, evidenceText);

    // Verify decryption works prior to shredding
    expect(store.decryptEvidence(extent).toString('utf8')).toBe(evidenceText);

    // Perform crypto-shredding (destroy salt)
    const shredded = saltStore.shredSubjectSalt(subjectId, 1_700_000_000_000_000);
    expect(shredded).toBe(true);

    // Verify key derivation and decryption fail completely post-shredding
    expect(() => store.deriveSubjectKey(subjectId)).toThrow(
      /subject salt for "subj-erased-404" was shredded or absent/
    );
    expect(() => store.decryptEvidence(extent)).toThrow();
  });

  it('creates non-brute-forceable keyed commitments using HKDF subject keys (AC-28)', () => {
    const saltStore = new SubjectSaltStore();
    const store = new CryptoShreddedStore(tenantMasterKeyRing, saltStore);

    const subjectId = 'subj-secret-777';
    saltStore.getOrCreateSalt(subjectId);
    const subjectKey = store.deriveSubjectKey(subjectId);

    const commitment = createKeyedPersonalCommitment(subjectKey, 'nationalId', 'DE-88291746');
    expect(commitment.digest).toMatch(/^sha256:[a-f0-9]{64}$/);

    // Verify different subject key produces completely different commitment digest
    const subjectId2 = 'subj-secret-888';
    saltStore.getOrCreateSalt(subjectId2);
    const subjectKey2 = store.deriveSubjectKey(subjectId2);

    const commitment2 = createKeyedPersonalCommitment(subjectKey2, 'nationalId', 'DE-88291746');
    expect(commitment.digest).not.toBe(commitment2.digest);

    // Verify shredding destroys ability to compute subject key & commitment
    saltStore.shredSubjectSalt(subjectId, 1_700_000_000_000_000);
    expect(() => store.deriveSubjectKey(subjectId)).toThrow();
  });
});
