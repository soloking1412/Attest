import { AttestError, serialize } from '@attest/core';
import { buildMetadata, createLucidSubmitter, verificationRecordFor } from '@attest/cardano';

import { boolFlag, flag, positional } from '../args.js';
import { connectKeria, type Command, type CommandContext } from '../context.js';
import { readAttestation } from '../document.js';

export const publish: Command = async (context) => {
  const { args, config, reporter } = context;

  const attestation = await readAttestation(positional(args, 0, 'attestation'));
  const issuerName = flag(args, 'issuer') ?? config.issuer;

  const client = await connectKeria(context);
  const identity = await client.identity(issuerName);
  if (identity.aid !== attestation.i) {
    throw new AttestError('ISSUER_NOT_AUTHORIZED', 'Local identifier does not match the document', {
      document: attestation.i,
      local: identity.aid,
      name: issuerName,
    });
  }

  const receipt = await client.anchor(issuerName, attestation.d);
  reporter.line(`Committed ${attestation.d} to the key event log`);
  reporter.detail('sequence', receipt.sequence);
  reporter.detail('event', receipt.eventSaid);

  const metadata = buildMetadata({
    attestation,
    sequence: receipt.sequence,
    includeDocument: !boolFlag(args, 'no-document'),
    ...(attestation.t === 'build' && !boolFlag(args, 'no-cip171')
      ? { verification: verificationRecordFor(attestation) }
      : {}),
  });

  if (boolFlag(args, 'dry-run')) {
    reporter.line('Dry run: transaction not submitted');
    reporter.detail('labels', Object.keys(metadata).join(', '));
    reporter.result({ attestation: serialize(attestation), receipt, metadata });
    return;
  }

  const submitter = await createLucidSubmitter({
    network: config.network,
    provider: providerConnection(context),
    wallet: walletKey(context),
  });

  const txHash = await submitter.submit(metadata);

  reporter.line('Published');
  reporter.detail('network', config.network);
  reporter.detail('tx', txHash);
  reporter.detail('labels', Object.keys(metadata).join(', '));
  reporter.result({ txHash, receipt, labels: Object.keys(metadata) });
};

const BLOCKFROST_URLS = {
  mainnet: 'https://cardano-mainnet.blockfrost.io/api/v0',
  preprod: 'https://cardano-preprod.blockfrost.io/api/v0',
  preview: 'https://cardano-preview.blockfrost.io/api/v0',
} as const;

const KOIOS_URLS = {
  mainnet: 'https://api.koios.rest/api/v1',
  preprod: 'https://preprod.koios.rest/api/v1',
  preview: 'https://preview.koios.rest/api/v1',
} as const;

function providerConnection(context: CommandContext) {
  const { config, secrets } = context;
  if (config.provider.kind === 'koios') {
    return { kind: 'koios' as const, url: config.provider.url ?? KOIOS_URLS[config.network] };
  }
  if (secrets.blockfrostProjectId === undefined) {
    throw new AttestError('PROVIDER_ERROR', 'BLOCKFROST_PROJECT_ID is not set');
  }
  return {
    kind: 'blockfrost' as const,
    url: config.provider.url ?? BLOCKFROST_URLS[config.network],
    projectId: secrets.blockfrostProjectId,
  };
}

function walletKey(context: CommandContext) {
  const { walletSeed, walletKey: privateKey } = context.secrets;
  if (walletSeed !== undefined) return { kind: 'seed' as const, seed: walletSeed };
  if (privateKey !== undefined) return { kind: 'privateKey' as const, privateKey };
  throw new AttestError('PROVIDER_ERROR', 'Set CARDANO_WALLET_SEED or CARDANO_WALLET_KEY');
}
