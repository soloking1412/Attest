import { describe, expect, it } from 'vitest';

import { toLucidMetadatum } from './lucid.js';

/**
 * Lucid validates metadata against a schema of native values. Passing the
 * tagged detailed-schema form is rejected at submission, which only shows up
 * against a funded wallet, so the conversion is pinned here.
 */
describe('Lucid metadata conversion', () => {
  it('converts integers to bigint', () => {
    expect(toLucidMetadatum(42)).toBe(42n);
    expect(toLucidMetadatum(0)).toBe(0n);
    expect(toLucidMetadatum(-7)).toBe(-7n);
  });

  it('converts prefixed hex to raw bytes', () => {
    expect(toLucidMetadatum('0xdeadbeef')).toEqual(Uint8Array.of(0xde, 0xad, 0xbe, 0xef));
  });

  it('leaves text as a string', () => {
    expect(toLucidMetadatum('ATTEST')).toBe('ATTEST');
  });

  it('treats a malformed hex payload as text', () => {
    expect(toLucidMetadatum('0xnothex')).toBe('0xnothex');
    expect(toLucidMetadatum('0xabc')).toBe('0xabc');
  });

  it('walks arrays', () => {
    expect(toLucidMetadatum(['a', 1, '0xff'])).toEqual(['a', 1n, Uint8Array.of(0xff)]);
  });

  it('walks nested objects', () => {
    expect(toLucidMetadatum({ t: 'ATTEST', v: { v: '1.0' } })).toEqual({
      t: 'ATTEST',
      v: { v: '1.0' },
    });
  });

  it('never emits the tagged detailed-schema form', () => {
    const converted = toLucidMetadatum({ chunks: ['0xdead', '0xbeef'] }) as Record<string, unknown>;
    expect(JSON.stringify(converted)).not.toContain('bytes');
    expect((converted.chunks as unknown[])[0]).toBeInstanceOf(Uint8Array);
  });
});
