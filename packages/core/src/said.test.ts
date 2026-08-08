import { describe, expect, it } from 'vitest';

import { canonicalBytes } from './canonical.js';
import { AttestError } from './errors.js';
import { computeSaid, saidify, serialize, verifySaid } from './said.js';
import { formatVersion, parseVersion } from './version.js';

const draft = () => ({
  v: formatVersion(0),
  d: '',
  t: 'build' as const,
  i: 'EKtQ1lymrnrh3qv5S18PBzQ7ukHGFJ7EXkH7B22XEMIL',
  dt: '2026-08-08T12:00:00.000000+00:00',
  a: { note: 'reproducible build' },
});

describe('self-addressing identifiers', () => {
  it('records the serialized size in the version string', () => {
    const document = saidify(draft());
    expect(parseVersion(document.v).size).toBe(canonicalBytes(document).length);
  });

  it('leaves the size unchanged when the placeholder is substituted', () => {
    const document = saidify(draft());
    const withPlaceholder = { ...document, d: '#'.repeat(document.d.length) };
    expect(canonicalBytes(withPlaceholder).length).toBe(canonicalBytes(document).length);
  });

  it('is deterministic', () => {
    expect(computeSaid(draft())).toBe(computeSaid(draft()));
  });

  it('changes when any field changes', () => {
    const other = { ...draft(), a: { note: 'reproducible builds' } };
    expect(computeSaid(draft())).not.toBe(computeSaid(other));
  });

  it('verifies a document it produced', () => {
    expect(() => verifySaid(saidify(draft()))).not.toThrow();
  });

  it('rejects a document whose body was altered after signing', () => {
    const document = saidify(draft());
    const tampered = { ...document, a: { note: 'tampered' } };
    expect(() => verifySaid(tampered)).toThrow(AttestError);
  });

  it('rejects a document whose version string was rewritten', () => {
    const document = saidify(draft());
    const tampered = { ...document, v: formatVersion(1) };
    expect(() => verifySaid(tampered)).toThrow(/size does not match/);
  });

  it('honours the digest algorithm implied by the identifier code', () => {
    const blake2b = saidify(draft(), 'blake2b-256');
    expect(blake2b.d.startsWith('F')).toBe(true);
    expect(() => verifySaid(blake2b)).not.toThrow();
  });

  it('serializes without whitespace and with the version string first', () => {
    const document = saidify(draft());
    expect(serialize(document).startsWith('{"v":"ATST10JSON')).toBe(true);
    expect(serialize(document)).not.toContain('\n');
  });

  it('survives a round trip through JSON.parse', () => {
    const document = saidify(draft());
    const reloaded = JSON.parse(serialize(document));
    expect(() => verifySaid(reloaded)).not.toThrow();
  });
});
