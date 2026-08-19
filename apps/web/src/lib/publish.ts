import type { Metadatum } from '@attest/core';

import type { Cip30Api } from './wallet';

export interface SubmitOptions {
  readonly api: Cip30Api;
  readonly metadata: Record<string, Metadatum>;
  readonly network: 'Mainnet' | 'Preprod' | 'Preview';
  readonly blockfrostUrl: string;
  readonly blockfrostProjectId: string;
}

/**
 * Builds and submits the attestation transaction in the browser, so the fee is
 * paid by the connected wallet and the signature never leaves it.
 *
 * Lucid is imported here rather than at module scope because it pulls in WASM
 * that cannot be evaluated during server rendering.
 */
export async function submitAttestation(options: SubmitOptions): Promise<string> {
  const lucid = await import('@lucid-evolution/lucid');
  const { toLucidMetadatum } = await import('@attest/cardano/lucid');

  const instance = await lucid.Lucid(
    new lucid.Blockfrost(options.blockfrostUrl, options.blockfrostProjectId),
    options.network,
  );
  instance.selectWallet.fromAPI(options.api as never);

  const builder = instance.newTx();
  for (const [label, value] of Object.entries(options.metadata)) {
    builder.attachMetadata(Number(label), toLucidMetadatum(value) as never);
  }

  const completed = await builder.complete();
  const signed = await completed.sign.withWallet().complete();
  return signed.submit();
}
