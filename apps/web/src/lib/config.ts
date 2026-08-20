import { AttestError, NETWORKS, type Network } from '@attest/core';

export interface KeriaConfig {
  readonly url: string;
  readonly bootUrl: string;
  readonly passcode: string;
}

export interface ServerConfig {
  readonly network: Network;
  readonly blockfrostProjectId: string;
  /**
   * Absent when no agent is configured. Publishing needs one, because it
   * extends a key event log; verification never does, because the logs it
   * reads are already published.
   */
  readonly keria?: KeriaConfig;
}

const BLOCKFROST_URLS: Readonly<Record<Network, string>> = {
  mainnet: 'https://cardano-mainnet.blockfrost.io/api/v0',
  preprod: 'https://cardano-preprod.blockfrost.io/api/v0',
  preview: 'https://cardano-preview.blockfrost.io/api/v0',
};

const LUCID_NETWORKS: Readonly<Record<Network, 'Mainnet' | 'Preprod' | 'Preview'>> = {
  mainnet: 'Mainnet',
  preprod: 'Preprod',
  preview: 'Preview',
};

export function blockfrostUrl(network: Network): string {
  return BLOCKFROST_URLS[network];
}

export function lucidNetwork(network: Network): 'Mainnet' | 'Preprod' | 'Preview' {
  return LUCID_NETWORKS[network];
}

export function readServerConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const network = env.ATTEST_NETWORK ?? 'preview';
  if (!(NETWORKS as readonly string[]).includes(network)) {
    throw new AttestError('PROVIDER_ERROR', 'ATTEST_NETWORK must name a Cardano network', {
      network,
    });
  }
  const url = env.KERIA_URL;
  const passcode = env.KERIA_PASSCODE;
  return {
    network: network as Network,
    blockfrostProjectId: required(env, 'BLOCKFROST_PROJECT_ID'),
    ...(url && passcode ? { keria: { url, bootUrl: env.KERIA_BOOT_URL ?? url, passcode } } : {}),
  };
}

/** Asserts an agent is configured, for the paths that cannot work without one. */
export function requireKeria(config: ServerConfig): KeriaConfig {
  if (config.keria === undefined) {
    throw new AttestError(
      'PROVIDER_ERROR',
      'Publishing needs a KERIA agent; set KERIA_URL and KERIA_PASSCODE',
    );
  }
  return config.keria;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (value === undefined || value.length === 0) {
    throw new AttestError('PROVIDER_ERROR', `${name} is not set`, { variable: name });
  }
  return value;
}
