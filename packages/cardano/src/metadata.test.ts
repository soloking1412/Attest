import { describe, expect, it } from 'vitest';

import {
  fromDetailedMetadata,
  fromDetailedSchema,
  toDetailedMetadata,
  toDetailedSchema,
} from './metadata.js';

describe('detailed schema conversion', () => {
  it('tags text as strings', () => {
    expect(toDetailedSchema('hello')).toEqual({ string: 'hello' });
  });

  it('tags prefixed hex as bytes', () => {
    expect(toDetailedSchema('0xdeadbeef')).toEqual({ bytes: 'deadbeef' });
  });

  it('treats a malformed hex payload as text', () => {
    expect(toDetailedSchema('0xnothex')).toEqual({ string: '0xnothex' });
    expect(toDetailedSchema('0xabc')).toEqual({ string: '0xabc' });
  });

  it('tags integers', () => {
    expect(toDetailedSchema(42)).toEqual({ int: 42 });
    expect(toDetailedSchema(-7)).toEqual({ int: -7 });
  });

  it('converts arrays into lists', () => {
    expect(toDetailedSchema(['a', 1])).toEqual({ list: [{ string: 'a' }, { int: 1 }] });
  });

  it('converts objects into key-value maps', () => {
    expect(toDetailedSchema({ t: 'ATTEST' })).toEqual({
      map: [{ k: { string: 't' }, v: { string: 'ATTEST' } }],
    });
  });

  it('round-trips nested structures', () => {
    const value = { t: 'ATTEST', v: { v: '1.0' }, h: ['0xabcd', 'plain'] };
    expect(fromDetailedSchema(toDetailedSchema(value))).toEqual(value);
  });

  it('rejects strings over the ledger limit', () => {
    expect(() => toDetailedSchema('a'.repeat(65))).toThrow(/exceeds 64 bytes/);
  });

  it('rejects byte payloads over the ledger limit', () => {
    expect(() => toDetailedSchema(`0x${'ab'.repeat(65)}`)).toThrow(/exceeds 64 bytes/);
  });

  it('measures strings in bytes rather than characters', () => {
    expect(() => toDetailedSchema('é'.repeat(33))).toThrow(/exceeds 64 bytes/);
    expect(() => toDetailedSchema('é'.repeat(32))).not.toThrow();
  });

  it('round-trips a full label map', () => {
    const metadata = { '170': { t: 'ATTEST' }, '1984': ['0xdead', '0xbeef'] };
    expect(fromDetailedMetadata(toDetailedMetadata(metadata))).toEqual(metadata);
  });

  it('rejects a label that is not an integer', () => {
    expect(() => toDetailedMetadata({ attest: 'x' })).toThrow(/non-negative integer/);
  });
});
