import { readFileSync } from 'node:fs';

import { fromHex, toHex } from '@attest/core';
import { describe, expect, it } from 'vitest';

import { parseBlueprint } from './blueprint.js';
import {
  computeScriptHash,
  inferPlutusVersion,
  isCborWrapped,
  normalizeScriptBytes,
} from './scripthash.js';

const fixture = parseBlueprint(
  readFileSync(new URL('./__fixtures__/plutus.json', import.meta.url), 'utf8'),
);
const validator = fixture.validators[0]!;

describe('script hashing', () => {
  it('reproduces the hash a published blueprint declares', () => {
    expect(computeScriptHash(validator.compiledCode, 'v2')).toBe(validator.hash);
  });

  it('produces a different hash under a different Plutus version', () => {
    expect(computeScriptHash(validator.compiledCode, 'v3')).not.toBe(validator.hash);
  });

  it('recovers the Plutus version a hash was produced under', () => {
    expect(inferPlutusVersion(validator.compiledCode, validator.hash!)).toBe('v2');
    expect(inferPlutusVersion(validator.compiledCode, 'ab'.repeat(28))).toBeUndefined();
  });

  it('returns 28 byte hashes', () => {
    expect(computeScriptHash(validator.compiledCode, 'v2')).toHaveLength(56);
  });
});

describe('compiled code normalization', () => {
  it('recognises the single wrapper a blueprint already carries', () => {
    expect(isCborWrapped(fromHex(validator.compiledCode))).toBe(true);
  });

  it('leaves an already wrapped script untouched', () => {
    const bytes = fromHex(validator.compiledCode);
    expect(toHex(normalizeScriptBytes(bytes))).toBe(validator.compiledCode);
  });

  it('is idempotent', () => {
    const once = normalizeScriptBytes(validator.compiledCode);
    expect(toHex(normalizeScriptBytes(once))).toBe(toHex(once));
  });

  it('wraps a bare flat program exactly once', () => {
    const bare = Uint8Array.of(0x01, 0x00, 0x00, 0x32);
    const wrapped = normalizeScriptBytes(bare);
    expect(toHex(wrapped)).toBe('4401000032');
    expect(isCborWrapped(wrapped)).toBe(true);
  });

  it('chooses the right header width as the payload grows', () => {
    for (const size of [23, 24, 255, 256, 65535, 65536]) {
      const payload = new Uint8Array(size).fill(0xab);
      const wrapped = normalizeScriptBytes(payload);
      expect(isCborWrapped(wrapped)).toBe(true);
      expect(wrapped.length).toBeGreaterThan(size);
    }
  });

  it('rejects empty input', () => {
    expect(() => normalizeScriptBytes(new Uint8Array())).toThrow(/empty/);
  });
});
