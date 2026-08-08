import { BYTES_PREFIX } from '@attest/core';
import { describe, expect, it } from 'vitest';

import {
  CHUNK_SIZE,
  CIP171_LABEL,
  COMPILER_CONSTRUCTORS,
  decodeCip171Metadata,
  decodeVerificationRecord,
  encodeVerificationRecord,
  toCip171Metadata,
  type VerificationRecord,
} from './cip171.js';

const record: VerificationRecord = {
  compiler: 'aiken',
  sourceUrl: 'https://github.com/example/vault',
  commit: '9f8e7d6c5b4a39281706f5e4d3c2b1a099887766',
  sourcePath: 'validators/vault.ak',
  compilerVersion: 'v1.1.9+e2fb28b',
};

describe('CIP-171 verification records', () => {
  it('uses the constructor id registered for the compiler', () => {
    expect(encodeVerificationRecord(record)).toMatchObject({
      kind: 'constr',
      tag: COMPILER_CONSTRUCTORS.aiken,
    });
  });

  it('round-trips through PlutusData', () => {
    expect(decodeVerificationRecord(encodeVerificationRecord(record))).toEqual(record);
  });

  it('encodes an absent source path as null', () => {
    const { sourcePath: _omitted, ...withoutPath } = record;
    const decoded = decodeVerificationRecord(encodeVerificationRecord(withoutPath));
    expect(decoded.sourcePath).toBeUndefined();
    expect(decoded).toEqual(withoutPath);
  });

  it('round-trips applied parameters keyed by script hash', () => {
    const withParameters: VerificationRecord = {
      ...record,
      parameters: { ['d7a75e29fc699c832922e4594b5ac04ed4701b06f680ed9d39a8e5b6']: ['182a'] },
    };
    expect(decodeVerificationRecord(encodeVerificationRecord(withParameters))).toEqual(
      withParameters,
    );
  });

  it('accepts 32 byte commit hashes', () => {
    const sha256Commit = { ...record, commit: 'ab'.repeat(32) };
    expect(decodeVerificationRecord(encodeVerificationRecord(sha256Commit)).commit).toBe(
      sha256Commit.commit,
    );
  });

  it('rejects a commit hash of another length', () => {
    expect(() => encodeVerificationRecord({ ...record, commit: 'ab'.repeat(16) })).toThrow(
      /20 or 32 bytes/,
    );
  });

  it('places chunks under label 1984', () => {
    expect(Object.keys(toCip171Metadata(record))).toEqual([String(CIP171_LABEL)]);
  });

  it('keeps every chunk within the ledger limit', () => {
    const long = { ...record, sourceUrl: `https://example.com/${'segment/'.repeat(30)}repo` };
    const chunks = toCip171Metadata(long)[String(CIP171_LABEL)]!;
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.startsWith(BYTES_PREFIX)).toBe(true);
      expect((chunk.length - BYTES_PREFIX.length) / 2).toBeLessThanOrEqual(CHUNK_SIZE);
    }
  });

  it('round-trips through chunked metadata', () => {
    const metadata = toCip171Metadata(record);
    expect(decodeCip171Metadata(metadata[String(CIP171_LABEL)])).toEqual(record);
  });

  it('accepts chunks without the bytes prefix', () => {
    const chunks = toCip171Metadata(record)[String(CIP171_LABEL)]!.map((chunk) =>
      chunk.slice(BYTES_PREFIX.length),
    );
    expect(decodeCip171Metadata(chunks)).toEqual(record);
  });

  it('rejects a compiler outside the registry', () => {
    expect(() => encodeVerificationRecord({ ...record, compiler: 'solc' as never })).toThrow(
      /outside the CIP-171 registry/,
    );
  });
});
