import { createHash } from 'node:crypto';

import { KeriaClient, type AnchorReceipt } from '@attest/keri';

import { readServerConfig } from './config';

/**
 * Each connected wallet gets its own autonomic identifier, derived from a
 * stable name so the same wallet always extends the same key event log. The
 * identifier is what makes an attestation attributable; the wallet is what
 * pays for it.
 */
export function issuerName(address: string): string {
  return `w-${createHash('sha256').update(address).digest('hex').slice(0, 24)}`;
}

let client: Promise<KeriaClient> | undefined;

function agent(): Promise<KeriaClient> {
  if (client === undefined) {
    const config = readServerConfig();
    client = KeriaClient.connect({
      url: config.keriaUrl,
      bootUrl: config.keriaBootUrl,
      passcode: config.keriaPasscode,
      boot: true,
    }).catch((error: unknown) => {
      client = undefined;
      throw error;
    });
  }
  return client;
}

export async function identifierFor(address: string): Promise<{ name: string; aid: string }> {
  const keria = await agent();
  const name = issuerName(address);
  try {
    const existing = await keria.identity(name);
    return { name, aid: existing.aid };
  } catch {
    const created = await keria.createIdentity(name);
    await keria.authorizeAgent(name);
    return { name, aid: created.aid };
  }
}

export async function anchor(name: string, said: string): Promise<AnchorReceipt> {
  return (await agent()).anchor(name, said);
}
