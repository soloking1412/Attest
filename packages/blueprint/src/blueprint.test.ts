import { readFileSync } from 'node:fs';

import { AttestError } from '@attest/core';
import { describe, expect, it } from 'vitest';

import {
  blueprintDigest,
  blueprintScripts,
  compilerRef,
  findValidator,
  parseBlueprint,
} from './blueprint.js';
import { normalizeRemoteUrl } from './git.js';

const raw = readFileSync(new URL('./__fixtures__/plutus.json', import.meta.url), 'utf8');
const fixture = parseBlueprint(raw);

describe('blueprint parsing', () => {
  it('reads the preamble', () => {
    expect(fixture.preamble.plutusVersion).toBe('v2');
    expect(fixture.preamble.compiler?.name).toBe('Aiken');
  });

  it('flags validators that still need parameters applied', () => {
    expect(fixture.validators[0]?.parameterized).toBe(true);
  });

  it('maps the compiler onto the CIP-171 registry', () => {
    expect(compilerRef(fixture)).toEqual({ name: 'aiken', version: 'v1.0.20-alpha+49bd4ba' });
  });

  it('rejects a blueprint with no validators', () => {
    expect(() => parseBlueprint({ preamble: fixture.preamble, validators: [] })).toThrow(
      AttestError,
    );
  });

  it('rejects a blueprint with an unknown Plutus version', () => {
    expect(() =>
      parseBlueprint({
        preamble: { ...fixture.preamble, plutusVersion: 'v4' },
        validators: [{ title: 'x', compiledCode: '00' }],
      }),
    ).toThrow(/plutusVersion/);
  });
});

describe('script extraction', () => {
  it('agrees with the hash the blueprint declares', () => {
    const scripts = blueprintScripts(fixture);
    expect(scripts).toHaveLength(1);
    expect(scripts[0]?.hash).toBe(fixture.validators[0]?.hash);
  });

  it('rejects a blueprint whose declared hash does not follow from its bytecode', () => {
    const tampered = JSON.parse(raw);
    tampered.validators[0].hash = 'ab'.repeat(28);
    expect(() => blueprintScripts(parseBlueprint(tampered))).toThrow(/does not match/);
  });

  it('deduplicates validators that compile to the same script', () => {
    const duplicated = JSON.parse(raw);
    duplicated.validators.push({
      ...duplicated.validators[0],
      title: 'one_time_minting_policy.else',
    });
    expect(blueprintScripts(parseBlueprint(duplicated))).toHaveLength(1);
  });

  it('finds a validator by its full or leading title', () => {
    expect(findValidator(fixture, 'one_time_minting_policy.one_time_minting_policy').title).toBe(
      'one_time_minting_policy.one_time_minting_policy',
    );
    expect(findValidator(fixture, 'one_time_minting_policy').title).toContain(
      'one_time_minting_policy',
    );
  });

  it('reports the available titles when a lookup fails', () => {
    expect(() => findValidator(fixture, 'missing')).toThrow(/no validator with that title/);
  });
});

describe('blueprint digest', () => {
  it('covers the file bytes exactly', () => {
    expect(blueprintDigest(raw)).toBe(blueprintDigest(raw));
    expect(blueprintDigest(raw)).not.toBe(blueprintDigest(`${raw} `));
  });

  it('is a CESR digest', () => {
    expect(blueprintDigest(raw)).toHaveLength(44);
  });
});

describe('remote URL normalization', () => {
  it('rewrites scp-style remotes to https', () => {
    expect(normalizeRemoteUrl('git@github.com:example/vault.git')).toBe(
      'https://github.com/example/vault',
    );
  });

  it('rewrites ssh remotes to https', () => {
    expect(normalizeRemoteUrl('ssh://git@github.com/example/vault.git')).toBe(
      'https://github.com/example/vault',
    );
  });

  it('strips the git suffix from https remotes', () => {
    expect(normalizeRemoteUrl('https://github.com/example/vault.git')).toBe(
      'https://github.com/example/vault',
    );
  });

  it('leaves an already clean remote alone', () => {
    expect(normalizeRemoteUrl('https://gitlab.com/example/vault')).toBe(
      'https://gitlab.com/example/vault',
    );
  });
});
