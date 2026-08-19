import { AttestError, NETWORKS, type Network } from '@attest/core';

export interface ServerConfig {
  readonly network: Network;
  readonly blockfrostProjectId: string;
  readonly keriaUrl: string;
  readonly keriaBootUrl: string;
  readonly keriaPasscode: string;
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
  return {
    network: network as Network,
    blockfrostProjectId: required(env, 'BLOCKFROST_PROJECT_ID'),
    keriaUrl: required(env, 'KERIA_URL'),
    keriaBootUrl: env.KERIA_BOOT_URL ?? required(env, 'KERIA_URL'),
    keriaPasscode: required(env, 'KERIA_PASSCODE'),
  };
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (value === undefined || value.length === 0) {
    throw new AttestError('PROVIDER_ERROR', `${name} is not set`, { variable: name });
  }
  return value;
}
