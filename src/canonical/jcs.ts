import { createHash } from 'node:crypto';
import canonicalize from 'canonicalize';

/**
 * Computes canonical JSON serialization string according to RFC 8785 (JCS).
 * Throws an error if any non-canonical float or un-serializable object is present.
 */
export function canonicalizeJson(obj: unknown): string {
  const canonicalFn = typeof canonicalize === 'function' ? canonicalize : (canonicalize as { default?: (o: unknown) => string }).default;
  if (!canonicalFn) {
    throw new Error('JCS Canonicalization failed: canonicalize module not found');
  }
  const result = canonicalFn(obj);
  if (result === undefined) {
    throw new Error('JCS Canonicalization failed: input cannot be serialized to JSON');
  }
  return result;
}

/**
 * Computes a sha256 digest over the canonicalized JSON representation of an object.
 * Returns formatted as `sha256:<hex_digest>`.
 */
export function canonicalDigest(obj: unknown): string {
  const canonicalStr = canonicalizeJson(obj);
  const hash = createHash('sha256').update(canonicalStr, 'utf8').digest('hex');
  return `sha256:${hash}`;
}

/**
 * Computes a sha256 digest over raw string or Uint8Array.
 */
export function computeSha256(data: string | Uint8Array): string {
  const hash = createHash('sha256').update(data).digest('hex');
  return `sha256:${hash}`;
}
