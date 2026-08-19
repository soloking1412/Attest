import { blockfrostUrl, lucidNetwork, readServerConfig } from '@/lib/config';

export const runtime = 'nodejs';

/** Public settings the browser needs to build a transaction. */
export async function GET(): Promise<Response> {
  try {
    const config = readServerConfig();
    return Response.json({
      network: config.network,
      lucidNetwork: lucidNetwork(config.network),
      blockfrostUrl: blockfrostUrl(config.network),
      blockfrostProjectId: config.blockfrostProjectId,
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Not configured' },
      { status: 500 },
    );
  }
}
