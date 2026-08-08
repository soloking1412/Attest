import { describe, expect, it } from 'vitest';

import { fromHex } from './bytes.js';
import { decodeMatter, encodeMatter, isQb64, MatterCode, qb64Length } from './cesr.js';
import { AttestError } from './errors.js';

const RAW_32 = fromHex('00'.repeat(31) + 'ff');

describe('CESR Matter encoding', () => {
  it('produces 44 character primitives for 32 byte payloads', () => {
    expect(qb64Length(MatterCode.Blake3_256)).toBe(44);
    expect(encodeMatter(MatterCode.Blake3_256, RAW_32)).toHaveLength(44);
  });

  it('produces 88 character primitives for 64 byte signatures', () => {
    expect(qb64Length(MatterCode.Ed25519Sig)).toBe(88);
    expect(encodeMatter(MatterCode.Ed25519Sig, new Uint8Array(64))).toHaveLength(88);
  });

  it('round-trips through decode', () => {
    const qb64 = encodeMatter(MatterCode.Blake2b_256, RAW_32);
    const decoded = decodeMatter(qb64);
    expect(decoded.code).toBe(MatterCode.Blake2b_256);
    expect(decoded.raw).toEqual(RAW_32);
  });

  it('carries the code as the leading character', () => {
    expect(encodeMatter(MatterCode.Blake3_256, RAW_32).startsWith('E')).toBe(true);
    expect(encodeMatter(MatterCode.Ed25519, RAW_32).startsWith('D')).toBe(true);
  });

  it('reads two-character codes that begin with a digit', () => {
    const qb64 = encodeMatter(MatterCode.Ed25519Sig, new Uint8Array(64).fill(7));
    expect(qb64.slice(0, 2)).toBe('0B');
    expect(decodeMatter(qb64).raw).toHaveLength(64);
  });

  it('accepts identifiers produced by KERI tooling', () => {
    expect(isQb64('EKtQ1lymrnrh3qv5S18PBzQ7ukHGFJ7EXkH7B22XEMIL')).toBe(true);
  });

  it('rejects a primitive whose length does not match its code', () => {
    expect(() => decodeMatter('Eshort')).toThrow(AttestError);
  });

  it('rejects a primitive carrying non-zero pad bits', () => {
    const qb64 = encodeMatter(MatterCode.Blake3_256, RAW_32);
    // The character after a one-character code may only set the low two bits of
    // the leading byte; 'Z' sets a higher bit and cannot have been produced by
    // a conforming encoder.
    const corrupted = `${qb64[0]}Z${qb64.slice(2)}`;
    expect(() => decodeMatter(corrupted)).toThrow(/pad bits/);
  });

  it('rejects raw payloads of the wrong length', () => {
    expect(() => encodeMatter(MatterCode.Blake3_256, new Uint8Array(31))).toThrow(AttestError);
  });
});
