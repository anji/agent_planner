import { describe, expect, it } from 'vitest';
import { canonicalizeJson, canonicalDigest, computeSha256 } from '../../src/canonical/jcs.js';

describe('RFC 8785 Canonical JSON Serialization (JCS)', () => {
  it('sorts object keys lexicographically', () => {
    const unordered = { z: 1, a: 2, m: { b: 3, a: 4 } };
    const canonical = canonicalizeJson(unordered);
    expect(canonical).toBe('{"a":2,"m":{"a":4,"b":3},"z":1}');
  });

  it('generates consistent sha256 digests', () => {
    const obj1 = { b: 'hello', a: 123 };
    const obj2 = { a: 123, b: 'hello' };
    const digest1 = canonicalDigest(obj1);
    const digest2 = canonicalDigest(obj2);
    expect(digest1).toBe(digest2);
    expect(digest1).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('computes raw SHA-256 digest', () => {
    const digest = computeSha256('test');
    expect(digest).toMatch(/^sha256:[a-f0-9]{64}$/);
  });
});
