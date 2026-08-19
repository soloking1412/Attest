import { AttestError } from '@attest/core';
import { BlockfrostProvider } from '@attest/cardano';
import { KeriaResolver } from '@attest/keri';
import { verifyTransaction } from '@attest/verifier/verify';

import { readServerConfig } from '@/lib/config';

export const runtime = 'nodejs';

/**
 * Verifies a published attestation from chain data. Anyone can run the same
 * check themselves; this endpoint exists so a wallet or explorer does not have
 * to.
 */
export async function GET(request: Request): Promise<Response> {
  const tx = new URL(request.url).searchParams.get('tx');
  if (tx === null || !/^[0-9a-f]{64}$/.test(tx.toLowerCase())) {
    return Response.json({ error: 'Pass tx as a 32-byte hex transaction hash' }, { status: 400 });
  }

  try {
    const config = readServerConfig();
    const provider = new BlockfrostProvider({
      projectId: config.blockfrostProjectId,
      network: config.network,
    });
    const resolver = await KeriaResolver.connect({
      url: config.keriaUrl,
      bootUrl: config.keriaBootUrl,
      passcode: config.keriaPasscode,
    });

    const hash = tx.toLowerCase();
    if ((await provider.transaction(hash)) === undefined) {
      // A transaction is invisible to the provider until it reaches a block,
      // which is a wait rather than a failure. Saying "not found" here sends
      // people looking for a mistake they have not made.
      return Response.json(
        {
          error: 'Not in a block yet. Preview settles in about 20 seconds; try again shortly.',
          pending: true,
        },
        { status: 202 },
      );
    }

    const report = await verifyTransaction(provider, hash, { resolver, provider });
    return Response.json(report);
  } catch (error) {
    if (error instanceof AttestError) {
      return Response.json({ error: error.message, code: error.code }, { status: 400 });
    }
    return Response.json(
      { error: error instanceof Error ? error.message : 'Verification failed' },
      { status: 500 },
    );
  }
}
