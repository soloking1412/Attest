import { AttestError, qb64Digest } from '@attest/core';
import { describe, expect, it } from 'vitest';

import {
  anchoredDigests,
  anchorsDigest,
  assertAnchored,
  assertContiguous,
  findEvent,
  parseKeyEvent,
  parseKeyEventLog,
} from './kel.js';
import { StaticKelResolver } from './resolver.js';

const AID = 'EKtQ1lymrnrh3qv5S18PBzQ7ukHGFJ7EXkH7B22XEMIL';
const OTHER_AID = 'EBcIURLpxmVwahksgrsGW6_dUw0zBhyEHYFk17eWrZfk';
const SAID_A = 'ELC5L3iBVD77d_MYbYGGCUQgqQBju1o4x1Ud-z2sL-ux';
const SAID_B = 'EMllBWiKvz2wgDrY_regDrFa9ZDbAOgVHVfODeQ-tGwn';

const inception = {
  v: 'KERI10JSON0000fa_',
  t: 'icp',
  d: 'EAoTNZH3ULvYAfSVPzhzS6b5CMZAoTNZH3ULvYAfSVPz',
  i: AID,
  s: '0',
  a: [],
};

const interaction = (sequence: string, prior: string, said: string, digest: string) => ({
  v: 'KERI10JSON0000cb_',
  t: 'ixn',
  d: said,
  i: AID,
  s: sequence,
  p: prior,
  a: [{ d: digest }],
});

const first = interaction('1', inception.d, 'EGiVzhF3ULvYAfSVPzhzS6b5CMZAoTNZH3ULvYAfSVPz', SAID_A);
const second = interaction('2', first.d, 'EHkTNZH3ULvYAfSVPzhzS6b5CMZAoTNZH3ULvYAfSVPz', SAID_B);

const log = parseKeyEventLog([inception, first, second]);

/** Builds a chain long enough for sequence numbers to leave the single-digit range. */
function chain(length: number) {
  const events: Record<string, unknown>[] = [inception];
  for (let index = 1; index <= length; index += 1) {
    const previous = events[index - 1] as { d: string };
    events.push(
      interaction(
        index.toString(16),
        previous.d,
        qb64Digest(`event-${index}`),
        qb64Digest(`anchor-${index}`),
      ),
    );
  }
  return parseKeyEventLog(events);
}

describe('key event parsing', () => {
  it('reads the fields an anchor check needs', () => {
    const event = parseKeyEvent(first);
    expect(event).toMatchObject({
      type: 'ixn',
      identifier: AID,
      sequence: '1',
      prior: inception.d,
    });
    expect(event.anchors).toEqual([{ d: SAID_A }]);
  });

  it('reads the agent record form', () => {
    expect(parseKeyEventLog([{ ked: inception, atc: '' }])).toHaveLength(1);
  });

  it('treats inception as having no prior event', () => {
    expect(parseKeyEvent(inception).prior).toBeUndefined();
  });

  it('rejects an unknown event type', () => {
    expect(() => parseKeyEvent({ ...inception, t: 'vcp' })).toThrow(/Unsupported key event type/);
  });

  it('rejects an identifier that is not a CESR primitive', () => {
    expect(() => parseKeyEvent({ ...inception, i: 'nope' })).toThrow(AttestError);
  });

  it('ignores seals that are not objects', () => {
    expect(parseKeyEvent({ ...first, a: ['x', null, { d: SAID_A }] }).anchors).toEqual([
      { d: SAID_A },
    ]);
  });
});

describe('anchor lookup', () => {
  it('finds the event at a sequence number', () => {
    expect(findEvent(log, '2')?.said).toBe(second.d);
  });

  it('reads sequence numbers as hex rather than decimal', () => {
    const long = chain(0x11);
    expect(findEvent(long, 'a')?.anchors[0]?.d).toBe(qb64Digest('anchor-10'));
    expect(findEvent(long, '10')?.anchors[0]?.d).toBe(qb64Digest('anchor-16'));
  });

  it('rejects a sequence number that is not in canonical form', () => {
    expect(() => findEvent(log, '02')).toThrow(/lowercase hex/);
  });

  it('detects the digest an event commits to', () => {
    expect(anchorsDigest(parseKeyEvent(first), SAID_A)).toBe(true);
    expect(anchorsDigest(parseKeyEvent(first), SAID_B)).toBe(false);
  });

  it('lists every digest in sequence order', () => {
    expect(anchoredDigests(log)).toEqual([SAID_A, SAID_B]);
  });
});

describe('anchor verification', () => {
  it('accepts a digest committed at the stated sequence', () => {
    expect(assertAnchored(log, { identifier: AID, sequence: '1', said: SAID_A }).said).toBe(
      first.d,
    );
  });

  it('rejects a digest committed at a different sequence', () => {
    expect(() => assertAnchored(log, { identifier: AID, sequence: '2', said: SAID_A })).toThrow(
      /does not commit to that digest/,
    );
  });

  it('rejects a sequence beyond the end of the log', () => {
    expect(() => assertAnchored(log, { identifier: AID, sequence: '9', said: SAID_A })).toThrow(
      /no event at that sequence/,
    );
  });

  it('rejects a log belonging to another identifier', () => {
    expect(() =>
      assertAnchored(log, { identifier: OTHER_AID, sequence: '1', said: SAID_A }),
    ).toThrow(/different identifier/);
  });
});

describe('log integrity', () => {
  it('accepts an unbroken chain', () => {
    expect(() => assertContiguous(log, AID)).not.toThrow();
  });

  it('accepts events supplied out of order', () => {
    expect(() => assertContiguous(parseKeyEventLog([second, inception, first]))).not.toThrow();
  });

  it('rejects a gap in the sequence', () => {
    expect(() => assertContiguous(parseKeyEventLog([inception, second]))).toThrow(/has a gap/);
  });

  it('rejects a broken digest chain', () => {
    const forged = { ...second, p: 'EAAAAAAAULvYAfSVPzhzS6b5CMZAoTNZH3ULvYAfSVPz' };
    expect(() => assertContiguous(parseKeyEventLog([inception, first, forged]))).toThrow(
      /does not chain to its predecessor/,
    );
  });

  it('rejects a log that does not start at inception', () => {
    expect(() => assertContiguous(parseKeyEventLog([first, second]))).toThrow(
      /does not start at inception/,
    );
  });

  it('rejects an empty log', () => {
    expect(() => assertContiguous([])).toThrow(/is empty/);
  });
});

describe('static resolver', () => {
  it('serves a log it was given', async () => {
    const resolver = new StaticKelResolver({ [AID]: [inception, first, second] });
    expect(await resolver.resolve(AID)).toHaveLength(3);
  });

  it('reports which identifiers it knows about', async () => {
    const resolver = new StaticKelResolver({ [AID]: [inception] });
    await expect(resolver.resolve(OTHER_AID)).rejects.toThrow(/No key event log available/);
  });

  it('refuses to hold a log that is not contiguous', () => {
    expect(() => new StaticKelResolver({ [AID]: [inception, second] })).toThrow(/has a gap/);
  });
});
