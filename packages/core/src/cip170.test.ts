import { describe, expect, it } from 'vitest';

import {
  assertMetadataLimits,
  CIP170_LABEL,
  chunk,
  decodeRecord,
  encodeRecord,
  formatSequence,
  looksLikeCip170,
  METADATA_STRING_LIMIT,
  metadatumSize,
  parseSequence,
  toMetadata,
  unchunk,
} from './cip170.js';
import { AttestError } from './errors.js';
import { utf8 } from './bytes.js';

const ISSUER = 'EKtQ1lymrnrh3qv5S18PBzQ7ukHGFJ7EXkH7B22XEMIL';
const DIGEST = 'ELC5L3iBVD77d_MYbYGGCUQgqQBju1o4x1Ud-z2sL-ux';

describe('metadata chunking', () => {
  it('leaves short values intact', () => {
    expect(chunk('hello')).toBe('hello');
  });

  it('splits long values into pieces the ledger accepts', () => {
    const value = 'a'.repeat(200);
    const chunks = chunk(value);
    expect(Array.isArray(chunks)).toBe(true);
    for (const part of chunks as string[]) {
      expect(utf8(part).length).toBeLessThanOrEqual(METADATA_STRING_LIMIT);
    }
    expect(unchunk(chunks, 'c')).toBe(value);
  });

  it('never splits a multi-byte character', () => {
    const value = 'é'.repeat(100);
    const chunks = chunk(value) as string[];
    for (const part of chunks) {
      expect(utf8(part).length).toBeLessThanOrEqual(METADATA_STRING_LIMIT);
      expect(part).not.toContain('�');
    }
    expect(unchunk(chunks, 'c')).toBe(value);
  });

  it('measures the limit in bytes rather than characters', () => {
    const value = 'é'.repeat(40);
    expect(utf8(value).length).toBe(80);
    expect(Array.isArray(chunk(value))).toBe(true);
  });
});

describe('sequence numbers', () => {
  it('formats as lowercase hex without padding', () => {
    expect(formatSequence(0)).toBe('0');
    expect(formatSequence(26)).toBe('1a');
    expect(formatSequence(255)).toBe('ff');
  });

  it('round-trips', () => {
    expect(parseSequence(formatSequence(4095))).toBe(4095n);
  });

  it('rejects uppercase and zero-padded forms', () => {
    expect(() => parseSequence('1A')).toThrow(AttestError);
    expect(() => parseSequence('01')).toThrow(AttestError);
  });
});

describe('CIP-170 records', () => {
  it('encodes an ATTEST record with the fields the standard names', () => {
    const encoded = encodeRecord({
      type: 'ATTEST',
      issuer: ISSUER,
      digest: DIGEST,
      sequence: '1a',
    }) as Record<string, unknown>;

    expect(encoded).toMatchObject({
      t: 'ATTEST',
      i: ISSUER,
      d: DIGEST,
      s: '1a',
      v: { v: '1.0' },
    });
  });

  it('round-trips an ATTEST record carrying index hints', () => {
    const record = {
      type: 'ATTEST' as const,
      issuer: ISSUER,
      digest: DIGEST,
      sequence: 'ff',
      index: { t: 'build', h: ['a'.repeat(56)] },
    };
    expect(decodeRecord(encodeRecord(record))).toEqual(record);
  });

  it('round-trips an AUTH_BEGIN record whose credential needs chunking', () => {
    const record = {
      type: 'AUTH_BEGIN' as const,
      issuer: ISSUER,
      schema: DIGEST,
      credential: 'x'.repeat(500),
    };
    const decoded = decodeRecord(encodeRecord(record));
    expect(decoded).toEqual(record);
  });

  it('places the record under label 170', () => {
    const metadata = toMetadata({
      type: 'ATTEST',
      issuer: ISSUER,
      digest: DIGEST,
      sequence: '0',
    });
    expect(Object.keys(metadata)).toEqual([String(CIP170_LABEL)]);
  });

  it('rejects an identifier that is not a CESR primitive', () => {
    expect(() =>
      encodeRecord({ type: 'ATTEST', issuer: 'not-an-aid', digest: DIGEST, sequence: '0' }),
    ).toThrow(AttestError);
  });

  it('produces metadata within the ledger limits', () => {
    const metadata = toMetadata({
      type: 'AUTH_BEGIN',
      issuer: ISSUER,
      schema: DIGEST,
      credential: 'y'.repeat(2048),
    });
    expect(() => assertMetadataLimits(metadata as never)).not.toThrow();
  });

  it('flags over-long strings before submission', () => {
    expect(() => assertMetadataLimits({ note: 'z'.repeat(65) })).toThrow(/exceeds 64 bytes/);
  });

  it('measures prefixed hex as the bytes it becomes on chain', () => {
    expect(metadatumSize(`0x${'ab'.repeat(64)}`)).toBe(64);
    expect(() => assertMetadataLimits([`0x${'ab'.repeat(64)}`])).not.toThrow();
    expect(() => assertMetadataLimits([`0x${'ab'.repeat(65)}`])).toThrow(/exceeds 64 bytes/);
  });

  it('measures a string that only looks like hex as text', () => {
    expect(metadatumSize('0xzz')).toBe(4);
  });

  it('recognises candidate payloads during a chain scan', () => {
    expect(looksLikeCip170({ t: 'ATTEST', i: ISSUER })).toBe(true);
    expect(looksLikeCip170({ t: 'OTHER', i: ISSUER })).toBe(false);
    expect(looksLikeCip170({ msg: 'hello' })).toBe(false);
    expect(looksLikeCip170(null)).toBe(false);
  });
});
