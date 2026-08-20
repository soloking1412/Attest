import { AttestError } from '@attest/core';
import { describe, expect, it } from 'vitest';

import { parseKeyEventLog, type KeyEvent } from './kel.js';
import { FallbackKelResolver, StaticKelResolver, type KelResolver } from './resolver.js';

const AID = 'EKtQ1lymrnrh3qv5S18PBzQ7ukHGFJ7EXkH7B22XEMIL';

const records = [
  {
    v: 'KERI10JSON0000fa_',
    t: 'icp',
    d: 'EAoTNZH3ULvYAfSVPzhzS6b5CMZAoTNZH3ULvYAfSVPz',
    i: AID,
    s: '0',
    a: [],
  },
];

const log = parseKeyEventLog(records);

/** Stands in for a resolver whose backing service is unreachable. */
const unreachable: KelResolver = {
  name: 'unreachable',
  resolve() {
    return Promise.reject(new AttestError('PROVIDER_ERROR', 'Could not connect to the agent'));
  },
};

function recording(events: readonly KeyEvent[]): KelResolver & { calls: number } {
  return {
    name: 'recording',
    calls: 0,
    async resolve() {
      this.calls += 1;
      return events;
    },
  };
}

describe('resolver chain', () => {
  it('needs at least one resolver', () => {
    expect(() => new FallbackKelResolver([])).toThrow(/at least one/);
  });

  it('falls through to a captured log when the agent is unreachable', async () => {
    const resolver = new FallbackKelResolver([
      unreachable,
      new StaticKelResolver({ [AID]: records }),
    ]);
    await expect(resolver.resolve(AID)).resolves.toEqual(log);
  });

  it('prefers the first resolver that answers', async () => {
    const second = recording(log);
    const resolver = new FallbackKelResolver([recording(log), second]);

    await resolver.resolve(AID);
    expect(second.calls).toBe(0);
  });

  it('reports the last failure when nothing can supply the log', async () => {
    const resolver = new FallbackKelResolver([new StaticKelResolver(), unreachable]);
    await expect(resolver.resolve(AID)).rejects.toThrow(/Could not connect/);
  });

  it('names the chain it was built from', () => {
    const resolver = new FallbackKelResolver([unreachable, new StaticKelResolver()]);
    expect(resolver.name).toBe('unreachable|static');
  });
});
