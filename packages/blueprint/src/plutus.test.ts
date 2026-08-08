import { toHex, utf8 } from '@attest/core';
import { describe, expect, it } from 'vitest';

import {
  BYTE_STRING_CHUNK,
  decodePlutusData,
  encodePlutusData,
  type PlutusData,
} from './plutus.js';

const roundTrip = (data: PlutusData): PlutusData => decodePlutusData(encodePlutusData(data));

describe('PlutusData codec', () => {
  it('encodes small constructors with the 121 tag base', () => {
    expect(toHex(encodePlutusData({ kind: 'constr', tag: 0, fields: [] }))).toBe('d87980');
    expect(toHex(encodePlutusData({ kind: 'constr', tag: 6, fields: [] }))).toBe('d87f80');
  });

  it('encodes mid-range constructors with the 1280 tag base', () => {
    const encoded = encodePlutusData({ kind: 'constr', tag: 7, fields: [] });
    expect(toHex(encoded)).toBe('d9050080');
    expect(roundTrip({ kind: 'constr', tag: 127, fields: [] })).toEqual({
      kind: 'constr',
      tag: 127,
      fields: [],
    });
  });

  it('falls back to the generic constructor above 127', () => {
    expect(roundTrip({ kind: 'constr', tag: 900, fields: [{ kind: 'int', value: 1n }] })).toEqual({
      kind: 'constr',
      tag: 900,
      fields: [{ kind: 'int', value: 1n }],
    });
  });

  it('round-trips integers on both sides of zero', () => {
    for (const value of [0n, 1n, 23n, 24n, 255n, 256n, 65535n, 4294967296n, -1n, -256n, -70000n]) {
      expect(roundTrip({ kind: 'int', value })).toEqual({ kind: 'int', value });
    }
  });

  it('splits long byte strings into indefinite-length chunks', () => {
    const value = new Uint8Array(200).fill(0x5a);
    const encoded = encodePlutusData({ kind: 'bytes', value });
    expect(encoded[0]).toBe(0x5f);
    expect(encoded[encoded.length - 1]).toBe(0xff);
    expect(roundTrip({ kind: 'bytes', value })).toEqual({ kind: 'bytes', value });
  });

  it('keeps byte strings at the limit definite-length', () => {
    const value = new Uint8Array(BYTE_STRING_CHUNK).fill(1);
    expect(encodePlutusData({ kind: 'bytes', value })[0]).toBe(0x58);
  });

  it('round-trips nested structures', () => {
    const data: PlutusData = {
      kind: 'constr',
      tag: 2,
      fields: [
        { kind: 'bytes', value: utf8('https://github.com/example/vault') },
        { kind: 'list', items: [{ kind: 'int', value: 7n }, { kind: 'null' }] },
        {
          kind: 'map',
          entries: [
            [
              { kind: 'bytes', value: utf8('k') },
              { kind: 'int', value: -3n },
            ],
          ],
        },
      ],
    };
    expect(roundTrip(data)).toEqual(data);
  });

  it('rejects trailing bytes', () => {
    const encoded = encodePlutusData({ kind: 'int', value: 1n });
    expect(() => decodePlutusData(new Uint8Array([...encoded, 0x00]))).toThrow(/Trailing bytes/);
  });

  it('rejects truncated input', () => {
    expect(() => decodePlutusData(Uint8Array.of(0x58, 0x20))).toThrow(/ended inside/);
  });

  it('rejects a tag that is not a constructor', () => {
    expect(() => decodePlutusData(Uint8Array.of(0xc0, 0x00))).toThrow(
      /not a PlutusData constructor/,
    );
  });
});
