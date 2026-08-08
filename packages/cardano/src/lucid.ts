import { AttestError, type Metadatum, type Network } from '@attest/core';

import { toDetailedSchema, type DetailedMetadatum } from './metadata.js';
import type { Submitter } from './provider.js';

const PACKAGE = '@lucid-evolution/lucid';

const NETWORK_NAMES: Readonly<Record<Network, string>> = {
  mainnet: 'Mainnet',
  preprod: 'Preprod',
  preview: 'Preview',
};

export type ProviderConnection =
  | { readonly kind: 'blockfrost'; readonly url: string; readonly projectId: string }
  | { readonly kind: 'koios'; readonly url: string };

export type WalletKey =
  | { readonly kind: 'seed'; readonly seed: string }
  | { readonly kind: 'privateKey'; readonly privateKey: string };

export interface LucidSubmitterOptions {
  readonly network: Network;
  readonly provider: ProviderConnection;
  readonly wallet: WalletKey;
}

interface LucidTxBuilder {
  attachMetadata(label: number, metadata: DetailedMetadatum): LucidTxBuilder;
  complete(): Promise<{ sign: { withWallet(): { complete(): Promise<LucidSignedTx> } } }>;
}

interface LucidSignedTx {
  submit(): Promise<string>;
}

interface LucidInstance {
  newTx(): LucidTxBuilder;
  selectWallet: {
    fromSeed(seed: string): void;
    fromPrivateKey(key: string): void;
  };
  wallet(): { address(): Promise<string> };
}

interface LucidModule {
  Lucid(provider: unknown, network: string): Promise<LucidInstance>;
  Blockfrost: new (url: string, projectId: string) => unknown;
  Koios: new (url: string) => unknown;
}

/**
 * Publishes metadata-only transactions through Lucid Evolution.
 *
 * Lucid is an optional dependency: verification never needs to build a
 * transaction, so the write path is loaded only when something asks to publish.
 */
export async function createLucidSubmitter(options: LucidSubmitterOptions): Promise<Submitter> {
  const lucid = await load();
  const provider =
    options.provider.kind === 'blockfrost'
      ? new lucid.Blockfrost(options.provider.url, options.provider.projectId)
      : new lucid.Koios(options.provider.url);

  const instance = await lucid.Lucid(provider, NETWORK_NAMES[options.network]);
  if (options.wallet.kind === 'seed') instance.selectWallet.fromSeed(options.wallet.seed);
  else instance.selectWallet.fromPrivateKey(options.wallet.privateKey);

  return {
    network: options.network,

    async submit(metadata: Record<string, Metadatum>): Promise<string> {
      const builder = instance.newTx();
      for (const [label, value] of Object.entries(metadata)) {
        builder.attachMetadata(Number(label), toDetailedSchema(value));
      }
      const completed = await builder.complete();
      const signed = await completed.sign.withWallet().complete();
      return signed.submit();
    },

    address(): Promise<string> {
      return instance.wallet().address();
    },
  };
}

async function load(): Promise<LucidModule> {
  const specifier = PACKAGE;
  try {
    return (await import(specifier)) as LucidModule;
  } catch (cause) {
    throw new AttestError('PROVIDER_ERROR', `Publishing requires ${PACKAGE} to be installed`, {
      package: PACKAGE,
      cause: (cause as Error).message,
    });
  }
}
