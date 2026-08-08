import { AttestError } from '@attest/core';
import { describe, expect, it } from 'vitest';

import {
  createProvider,
  DEFAULT_CONFIG,
  parseConfig,
  readSecrets,
  requirePasscode,
} from './config.js';

describe('configuration', () => {
  it('falls back to defaults for omitted sections', () => {
    expect(parseConfig('{}')).toEqual(DEFAULT_CONFIG);
  });

  it('reads a full configuration', () => {
    const config = parseConfig({
      network: 'preprod',
      issuer: 'audits',
      keria: { url: 'http://keria:3901', bootUrl: 'http://keria:3903' },
      provider: { kind: 'koios' },
      build: { compiler: 'aiken', blueprint: 'out/plutus.json', image: 'aiken:v1.1.9' },
    });

    expect(config.network).toBe('preprod');
    expect(config.issuer).toBe('audits');
    expect(config.provider.kind).toBe('koios');
    expect(config.build.image).toBe('aiken:v1.1.9');
  });

  it('rejects a network Cardano does not have', () => {
    expect(() => parseConfig({ network: 'testnet' })).toThrow(/network/);
  });

  it('rejects a compiler outside the registry', () => {
    expect(() => parseConfig({ build: { compiler: 'solc' } })).toThrow(AttestError);
  });

  it('rejects a build command that is not an argument vector', () => {
    expect(() => parseConfig({ build: { command: 'aiken build' } })).toThrow(/array of arguments/);
  });
});

describe('secrets', () => {
  it('reads only from the environment', () => {
    const secrets = readSecrets({
      KERIA_PASSCODE: 'passcode',
      BLOCKFROST_PROJECT_ID: 'previewabc',
      CARDANO_WALLET_SEED: 'seed words',
    });
    expect(secrets).toEqual({
      keriaPasscode: 'passcode',
      blockfrostProjectId: 'previewabc',
      walletSeed: 'seed words',
    });
  });

  it('reports a missing passcode by variable name', () => {
    expect(() => requirePasscode({})).toThrow(/KERIA_PASSCODE/);
  });
});

describe('provider construction', () => {
  it('builds a Blockfrost provider for the configured network', () => {
    const provider = createProvider(parseConfig({ network: 'preprod' }), {
      blockfrostProjectId: 'preprodabc',
    });
    expect(provider.name).toBe('blockfrost');
    expect(provider.network).toBe('preprod');
  });

  it('builds a Koios provider without credentials', () => {
    const provider = createProvider(parseConfig({ provider: { kind: 'koios' } }), {});
    expect(provider.name).toBe('koios');
  });

  it('reports a missing project id by variable name', () => {
    expect(() => createProvider(DEFAULT_CONFIG, {})).toThrow(/BLOCKFROST_PROJECT_ID/);
  });

  it('honours the configured network over the project id prefix', () => {
    const provider = createProvider(parseConfig({ network: 'preview' }), {
      blockfrostProjectId: 'mainnetabc',
    });
    expect(provider.network).toBe('preview');
  });
});
