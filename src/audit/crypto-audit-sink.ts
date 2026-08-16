import { canonicalDigest } from '../canonical/jcs.js';
import { DecisionRecord } from '../types/index.js';

export interface AuditBlock {
  blockSequence: number;
  timestamp: number;
  previousRecordDigest: string;
  record: DecisionRecord | { marker: "TRUNCATED"; elidedReason: string };
  blockDigest: string;
}

export interface AuditSinkVerificationResult {
  valid: boolean;
  blockCount: number;
  brokenSequence?: number;
  error?: string;
}

/**
 * High-Volume Cryptographic Audit Sink (§13, §15 AC-30).
 * Appends decision records to a tamper-evident SHA-256 hash chain log stream.
 * Supports explicit TRUNCATED markers for diagnostic-tier data loss (AC-30).
 */
export class CryptographicAuditSink {
  private chain: AuditBlock[] = [];
  private lastDigest = 'sha256:0000000000000000000000000000000000000000000000000000000000000000';

  /** Standing Convention: timestamp MUST be supplied as data. Zero clock defaults! */
  public appendRecord(record: DecisionRecord, timestamp: number): AuditBlock {
    if (!timestamp) {
      throw new Error('appendRecord requires an explicit timestamp parameter.');
    }
    const sequence = this.chain.length + 1;
    const blockData = {
      blockSequence: sequence,
      timestamp,
      previousRecordDigest: this.lastDigest,
      record,
    };

    const blockDigest = canonicalDigest(blockData);
    const block: AuditBlock = {
      ...blockData,
      blockDigest,
    };

    this.chain.push(block);
    this.lastDigest = blockDigest;
    return block;
  }

  /**
   * Appends an explicit TRUNCATED diagnostic marker when diagnostic data is elided (AC-30).
   */
  public appendTruncatedMarker(elidedReason: string, timestamp: number): AuditBlock {
    if (!timestamp) {
      throw new Error('appendTruncatedMarker requires an explicit timestamp parameter.');
    }
    const sequence = this.chain.length + 1;
    const blockData = {
      blockSequence: sequence,
      timestamp,
      previousRecordDigest: this.lastDigest,
      record: { marker: 'TRUNCATED' as const, elidedReason },
    };

    const blockDigest = canonicalDigest(blockData);
    const block: AuditBlock = {
      ...blockData,
      blockDigest,
    };

    this.chain.push(block);
    this.lastDigest = blockDigest;
    return block;
  }

  public getChain(): AuditBlock[] {
    return [...this.chain];
  }

  /**
   * Verifies the cryptographic integrity of the entire audit hash chain.
   */
  public verifyChainIntegrity(): AuditSinkVerificationResult {
    let expectedPrevious = 'sha256:0000000000000000000000000000000000000000000000000000000000000000';

    for (let i = 0; i < this.chain.length; i++) {
      const block = this.chain[i]!;

      if (block.previousRecordDigest !== expectedPrevious) {
        const res: AuditSinkVerificationResult = {
          valid: false,
          blockCount: this.chain.length,
          brokenSequence: block.blockSequence,
          error: `Hash chain break at block #${block.blockSequence}: expected previous "${expectedPrevious}", got "${block.previousRecordDigest}"`,
        };
        return res;
      }

      const blockData = {
        blockSequence: block.blockSequence,
        timestamp: block.timestamp,
        previousRecordDigest: block.previousRecordDigest,
        record: block.record,
      };

      const computedDigest = canonicalDigest(blockData);
      if (computedDigest !== block.blockDigest) {
        const res: AuditSinkVerificationResult = {
          valid: false,
          blockCount: this.chain.length,
          brokenSequence: block.blockSequence,
          error: `Block digest tampered at block #${block.blockSequence}: recorded "${block.blockDigest}", computed "${computedDigest}"`,
        };
        return res;
      }

      expectedPrevious = block.blockDigest;
    }

    return {
      valid: true,
      blockCount: this.chain.length,
    };
  }
}
