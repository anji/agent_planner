import { describe, expect, it } from 'vitest';
import { CryptographicAuditSink } from '../../src/audit/crypto-audit-sink.js';
import { DecisionRecord } from '../../src/types/index.js';

describe('Cryptographic Tamper-Evident Audit Sink & Hash Chaining', () => {
  it('appends decision records and maintains SHA-256 hash chain integrity', () => {
    const sink = new CryptographicAuditSink();

    const record: DecisionRecord = {
      apiVersion: 'evidence.engine/v1alpha1',
      kind: 'DecisionRecord',
      decisionDigest: 'sha256:dec-1',
      goalDigest: 'sha256:goal-1',
      contextIntegrityDigest: 'sha256:ctx-1',
      selectedCapabilities: [],
      candidateEvaluations: [],
      appliedRelaxations: [],
      provenance: { compilerVersion: '0.1.0', solverAlgorithm: 'v1', bundleDigest: 'd', timestamp: 1000 },
      readSet: [],
      witnessedValues: [],
    };

    sink.appendRecord(record, 1_700_000_000_000_000);
    sink.appendTruncatedMarker('Diagnostic log elided per AC-30 quota', 1_700_000_000_000_001);

    const verifyRes = sink.verifyChainIntegrity();
    expect(verifyRes.valid).toBe(true);
    expect(verifyRes.blockCount).toBe(2);
  });

  it('detects tampering in audit log hash chain', () => {
    const sink = new CryptographicAuditSink();

    const record: DecisionRecord = {
      apiVersion: 'evidence.engine/v1alpha1',
      kind: 'DecisionRecord',
      decisionDigest: 'sha256:dec-1',
      goalDigest: 'sha256:goal-1',
      contextIntegrityDigest: 'sha256:ctx-1',
      selectedCapabilities: [],
      candidateEvaluations: [],
      appliedRelaxations: [],
      provenance: { compilerVersion: '0.1.0', solverAlgorithm: 'v1', bundleDigest: 'd', timestamp: 1000 },
      readSet: [],
      witnessedValues: [],
    };

    sink.appendRecord(record, 1_700_000_000_000_000);
    const chain = sink.getChain();

    // Tamper with block #1 digest
    (chain[0] as any).blockDigest = 'sha256:tampered';

    // Verify integrity detects break
    const verifyRes = sink.verifyChainIntegrity();
    expect(verifyRes.valid).toBe(false);
    expect(verifyRes.error).toContain('tampered');
  });
});
