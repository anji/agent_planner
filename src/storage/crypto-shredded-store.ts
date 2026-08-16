import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from 'node:crypto';
import { ContentRef, EpochMicros } from '../types/index.js';
import { canonicalizeJson, computeSha256 } from '../canonical/jcs.js';

export interface EncryptedExtent {
  extentUid: string;
  subjectId: string;
  ciphertextHex: string;
  ivHex: string;
  authTagHex: string;
  contentRef: ContentRef;
}

export interface ErasureTombstone {
  subjectId: string;
  erasedAt: EpochMicros;
  reason: string;
}

/**
 * Creates a secret-keyed commitment for personal values (§13, §18.6, AC-28).
 * Key: HKDF-derived secret subject key (from tenant key ring + subject salt).
 * Formula: HMAC-SHA256(subjectKey, attributeName || ":" || canonicalizeJson(value))
 * Media Type: application/vnd.evidence.keyed-commitment+sha256
 */
export function createKeyedPersonalCommitment(
  subjectKey: Buffer,
  attributeName: string,
  val: unknown
): ContentRef {
  const valJson = canonicalizeJson(val);
  const hmac = createHmac('sha256', subjectKey);
  hmac.update(`${attributeName}:${valJson}`);
  const digest = `sha256:${hmac.digest('hex')}`;

  return {
    digest,
    mediaType: 'application/vnd.evidence.keyed-commitment+sha256',
    sizeBytes: Buffer.byteLength(valJson, 'utf8'),
  };
}

/**
 * Append-only Erasure Journal (§12, AC-33).
 * Records permanent subject shredding tombstones in a separate failure domain.
 */
export class ErasureJournal {
  private tombstones = new Map<string, ErasureTombstone>();

  public appendTombstone(tombstone: ErasureTombstone): void {
    this.tombstones.set(tombstone.subjectId, tombstone);
  }

  public isTombstoned(subjectId: string): boolean {
    return this.tombstones.has(subjectId);
  }

  public getTombstone(subjectId: string): ErasureTombstone | undefined {
    return this.tombstones.get(subjectId);
  }

  public getTombstoneCount(): number {
    return this.tombstones.size;
  }
}

/**
 * Per-subject salt store managing crypto-shredding keys (§12, AC-33).
 * Filters backup restores against the ErasureJournal so pre-erasure backups cannot restore shredded salts.
 */
export class SubjectSaltStore {
  private salts = new Map<string, Buffer>();

  constructor(private journal: ErasureJournal = new ErasureJournal()) {}

  public getJournal(): ErasureJournal {
    return this.journal;
  }

  public getOrCreateSalt(subjectId: string): Buffer {
    if (this.journal.isTombstoned(subjectId)) {
      throw new Error(`Subject "${subjectId}" has been tombstoned in ErasureJournal; salt generation rejected.`);
    }

    let salt = this.salts.get(subjectId);
    if (!salt) {
      salt = randomBytes(32);
      this.salts.set(subjectId, salt);
    }
    return salt;
  }

  public getSalt(subjectId: string): Buffer | undefined {
    if (this.journal.isTombstoned(subjectId)) {
      return undefined;
    }
    return this.salts.get(subjectId);
  }

  /**
   * Destroys a subject salt and journals the tombstone (§12, AC-33).
   * Standing Convention: erasedAt MUST be supplied as data. Zero clock defaults!
   */
  public shredSubjectSalt(
    subjectId: string,
    erasedAt: EpochMicros,
    reason = 'GDPR right-to-be-forgotten'
  ): boolean {
    if (!erasedAt) {
      throw new Error('shredSubjectSalt requires an explicit erasedAt parameter.');
    }
    this.journal.appendTombstone({
      subjectId,
      erasedAt,
      reason,
    });
    return this.salts.delete(subjectId);
  }

  public restoreFromBackup(backupSalts: Map<string, Buffer>): number {
    let restored = 0;
    for (const [subj, salt] of backupSalts.entries()) {
      if (!this.journal.isTombstoned(subj)) {
        this.salts.set(subj, salt);
        restored++;
      }
    }
    return restored;
  }

  public hasSalt(subjectId: string): boolean {
    if (this.journal.isTombstoned(subjectId)) return false;
    return this.salts.has(subjectId);
  }
}

export class CryptoShreddedStore {
  constructor(
    private tenantKeyRing: Buffer,
    private saltStore: SubjectSaltStore
  ) {
    if (tenantKeyRing.length < 32) {
      throw new Error('Tenant key ring must be at least 32 bytes (256-bit)');
    }
  }

  public deriveSubjectKey(subjectId: string): Buffer {
    const salt = this.saltStore.getSalt(subjectId);
    if (!salt) {
      throw new Error(`Cannot derive key: subject salt for "${subjectId}" was shredded or absent.`);
    }

    const key = hkdfSync(
      'sha256',
      this.tenantKeyRing,
      salt,
      Buffer.from('agent-planner:subject-key:v1', 'utf8'),
      32
    );
    return Buffer.from(key);
  }

  public encryptEvidence(subjectId: string, plaintext: string | Buffer): EncryptedExtent {
    this.saltStore.getOrCreateSalt(subjectId);
    const subjectKey = this.deriveSubjectKey(subjectId);

    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', subjectKey, iv);

    const dataBuffer = typeof plaintext === 'string' ? Buffer.from(plaintext, 'utf8') : plaintext;
    const encrypted = Buffer.concat([cipher.update(dataBuffer), cipher.final()]);
    const authTag = cipher.getAuthTag();

    const digest = computeSha256(encrypted);
    const extentUid = `extent-${digest.substring(7, 23)}`;

    return {
      extentUid,
      subjectId,
      ciphertextHex: encrypted.toString('hex'),
      ivHex: iv.toString('hex'),
      authTagHex: authTag.toString('hex'),
      contentRef: {
        digest,
        mediaType: 'application/octet-stream+encrypted-extent',
        sizeBytes: encrypted.length,
      },
    };
  }

  public decryptEvidence(extent: EncryptedExtent): Buffer {
    const subjectKey = this.deriveSubjectKey(extent.subjectId);

    const iv = Buffer.from(extent.ivHex, 'hex');
    const authTag = Buffer.from(extent.authTagHex, 'hex');
    const ciphertext = Buffer.from(extent.ciphertextHex, 'hex');

    const decipher = createDecipheriv('aes-256-gcm', subjectKey, iv);
    decipher.setAuthTag(authTag);

    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }
}
