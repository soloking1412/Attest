import {
  FallbackKelResolver,
  KeriaResolver,
  StaticKelResolver,
  type KelResolver,
} from '@attest/keri';

import { readServerConfig } from './config';
import logs from './key-event-logs.json';

/**
 * Key event logs captured from the issuing agent, checked in so that
 * attestations already on chain stay verifiable when no agent is running.
 *
 * A log is append-only and public, so serving a captured copy asserts nothing
 * a live agent would not. It is a snapshot, though: identifiers it does not
 * cover, and events appended after it was taken, are only reachable from an
 * agent.
 */
export const capturedLogs: Readonly<Record<string, unknown>> = logs;

/**
 * Builds the chain verification reads from. A configured agent goes first so
 * newly anchored attestations resolve immediately; the captured logs stand in
 * when it is unreachable.
 */
export async function kelResolver(): Promise<KelResolver> {
  const captured = new StaticKelResolver(capturedLogs);
  const { keria } = readServerConfig();
  if (keria === undefined) return captured;

  try {
    const live = await KeriaResolver.connect({
      url: keria.url,
      bootUrl: keria.bootUrl,
      passcode: keria.passcode,
    });
    return new FallbackKelResolver([live, captured]);
  } catch {
    // An unreachable agent is not a verification failure. It only limits the
    // set of identifiers that can be resolved to the ones captured here.
    return captured;
  }
}
