import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  assertOneOf,
  assertRecord,
  assertString,
  AttestError,
  COMPILERS,
  NETWORKS,
  type Compiler,
  type Network,
} from '@attest/core';
import { BlockfrostProvider, KoiosProvider, type ChainProvider } from '@attest/cardano';

export const CONFIG_FILE = 'attest.config.json';

export interface BuildConfig {
  readonly compiler: Compiler;
  readonly blueprint: string;
  /** Container image builds run inside, pinned by digest where possible. */
  readonly image?: string;
  readonly command?: readonly string[];
}

export interface KeriaConfig {
  readonly url: string;
  readonly bootUrl?: string;
}

export interface AttestConfig {
  readonly network: Network;
  /** Name of the local identifier attestations are issued under. */
  readonly issuer: string;
  readonly keria: KeriaConfig;
  readonly provider: { readonly kind: 'blockfrost' | 'koios'; readonly url?: string };
  readonly build: BuildConfig;
}

export const DEFAULT_CONFIG: AttestConfig = {
  network: 'preview',
  issuer: 'release',
  keria: { url: 'http://localhost:3901', bootUrl: 'http://localhost:3903' },
  provider: { kind: 'blockfrost' },
  build: { compiler: 'aiken', blueprint: 'plutus.json' },
};

/**
 * Secrets are read from the environment rather than the config file, so the
 * file can be committed alongside the contracts it describes.
 */
export interface Secrets {
  readonly keriaPasscode?: string;
  readonly blockfrostProjectId?: string;
  readonly walletSeed?: string;
  readonly walletKey?: string;
}

export function readSecrets(env: NodeJS.ProcessEnv = process.env): Secrets {
  return {
    ...(env.KERIA_PASSCODE !== undefined ? { keriaPasscode: env.KERIA_PASSCODE } : {}),
    ...(env.BLOCKFROST_PROJECT_ID !== undefined
      ? { blockfrostProjectId: env.BLOCKFROST_PROJECT_ID }
      : {}),
    ...(env.CARDANO_WALLET_SEED !== undefined ? { walletSeed: env.CARDANO_WALLET_SEED } : {}),
    ...(env.CARDANO_WALLET_KEY !== undefined ? { walletKey: env.CARDANO_WALLET_KEY } : {}),
  };
}

export async function loadConfig(cwd = process.cwd()): Promise<AttestConfig> {
  let raw: string;
  try {
    raw = await readFile(resolve(cwd, CONFIG_FILE), 'utf8');
  } catch {
    return DEFAULT_CONFIG;
  }
  return parseConfig(raw);
}

export function parseConfig(input: string | unknown): AttestConfig {
  const value: unknown = typeof input === 'string' ? JSON.parse(input) : input;
  assertRecord(value, 'config');

  const network = value.network ?? DEFAULT_CONFIG.network;
  assertOneOf(network, 'network', NETWORKS);

  const issuer = value.issuer ?? DEFAULT_CONFIG.issuer;
  assertString(issuer, 'issuer');

  return {
    network,
    issuer,
    keria: readKeria(value.keria),
    provider: readProvider(value.provider),
    build: readBuild(value.build),
  };
}

function readKeria(value: unknown): KeriaConfig {
  if (value === undefined) return DEFAULT_CONFIG.keria;
  assertRecord(value, 'keria');
  assertString(value.url, 'keria.url');
  return {
    url: value.url,
    ...(typeof value.bootUrl === 'string' ? { bootUrl: value.bootUrl } : {}),
  };
}

function readProvider(value: unknown): AttestConfig['provider'] {
  if (value === undefined) return DEFAULT_CONFIG.provider;
  assertRecord(value, 'provider');
  assertOneOf(value.kind, 'provider.kind', ['blockfrost', 'koios'] as const);
  return {
    kind: value.kind,
    ...(typeof value.url === 'string' ? { url: value.url } : {}),
  };
}

function readBuild(value: unknown): BuildConfig {
  if (value === undefined) return DEFAULT_CONFIG.build;
  assertRecord(value, 'build');

  const compiler = value.compiler ?? DEFAULT_CONFIG.build.compiler;
  assertOneOf(compiler, 'build.compiler', COMPILERS);

  const blueprint = value.blueprint ?? DEFAULT_CONFIG.build.blueprint;
  assertString(blueprint, 'build.blueprint');

  const command = value.command;
  if (command !== undefined && !Array.isArray(command)) {
    throw new AttestError('INVALID_DOCUMENT', 'build.command must be an array of arguments');
  }

  return {
    compiler,
    blueprint,
    ...(typeof value.image === 'string' ? { image: value.image } : {}),
    ...(command !== undefined ? { command: command.map(String) } : {}),
  };
}

export function createProvider(config: AttestConfig, secrets: Secrets): ChainProvider {
  if (config.provider.kind === 'koios') {
    return new KoiosProvider({
      network: config.network,
      ...(config.provider.url !== undefined ? { baseUrl: config.provider.url } : {}),
    });
  }
  if (secrets.blockfrostProjectId === undefined) {
    throw new AttestError('PROVIDER_ERROR', 'BLOCKFROST_PROJECT_ID is not set', {
      variable: 'BLOCKFROST_PROJECT_ID',
    });
  }
  return new BlockfrostProvider({
    projectId: secrets.blockfrostProjectId,
    network: config.network,
    ...(config.provider.url !== undefined ? { baseUrl: config.provider.url } : {}),
  });
}

export function requirePasscode(secrets: Secrets): string {
  if (secrets.keriaPasscode === undefined) {
    throw new AttestError('PROVIDER_ERROR', 'KERIA_PASSCODE is not set', {
      variable: 'KERIA_PASSCODE',
    });
  }
  return secrets.keriaPasscode;
}
