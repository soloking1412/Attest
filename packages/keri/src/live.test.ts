import { qb64Digest } from '@attest/core';
import { describe, expect, it } from 'vitest';

import { KeriaClient } from './client.js';
import { assertAnchored } from './kel.js';

const url = process.env.KERIA_URL;
const bootUrl = process.env.KERIA_BOOT_URL ?? url;

/**
 * Exercises the anchoring path against a running KERIA agent. Skipped unless
 * KERIA_URL is set, because the rest of the suite must stay runnable offline.
 *
 *   docker run -d -p 3901:3901 -p 3902:3902 -p 3903:3903 weboftrust/keria
 *   KERIA_URL=http://localhost:3901 KERIA_BOOT_URL=http://localhost:3903 pnpm test
 */
describe.skipIf(url === undefined)('anchoring against a live agent', () => {
  it('commits a digest to the log and verifies it at the stated sequence', async () => {
    const client = await KeriaClient.connect({
      url: url as string,
      ...(bootUrl !== undefined ? { bootUrl } : {}),
      passcode: await KeriaClient.randomPasscode(),
      boot: true,
    });

    const name = `test-${Date.now()}`;
    const identity = await client.createIdentity(name);
    expect(identity.aid).toHaveLength(44);

    const said = qb64Digest(`attestation-${name}`);
    const receipt = await client.anchor(name, said);

    expect(receipt.identifier).toBe(identity.aid);
    expect(receipt.sequence).toBe('1');

    const log = await client.keyEventLog(identity.aid);
    expect(log).toHaveLength(2);
    expect(log[0]?.type).toBe('icp');

    const event = assertAnchored(log, {
      identifier: identity.aid,
      sequence: receipt.sequence,
      said,
    });
    expect(event.type).toBe('ixn');
    expect(event.said).toBe(receipt.eventSaid);
  }, 120_000);

  it('rejects a digest the log does not commit to', async () => {
    const client = await KeriaClient.connect({
      url: url as string,
      ...(bootUrl !== undefined ? { bootUrl } : {}),
      passcode: await KeriaClient.randomPasscode(),
      boot: true,
    });

    const name = `test-${Date.now()}-negative`;
    const identity = await client.createIdentity(name);
    await client.anchor(name, qb64Digest('real'));

    const log = await client.keyEventLog(identity.aid);
    expect(() =>
      assertAnchored(log, {
        identifier: identity.aid,
        sequence: '1',
        said: qb64Digest('forged'),
      }),
    ).toThrow(/does not commit to that digest/);
  }, 120_000);
});
