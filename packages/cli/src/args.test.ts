import { describe, expect, it } from 'vitest';

import { boolFlag, flag, flags, parseArgs, positional, requireFlag } from './args.js';

describe('argument parsing', () => {
  it('separates positionals from options', () => {
    const args = parseArgs(['verify', 'abc123', '--json']);
    expect(args.positional).toEqual(['verify', 'abc123']);
    expect(boolFlag(args, 'json')).toBe(true);
  });

  it('reads both option spellings', () => {
    expect(flag(parseArgs(['--out', 'a.json']), 'out')).toBe('a.json');
    expect(flag(parseArgs(['--out=a.json']), 'out')).toBe('a.json');
  });

  it('collects repeated options', () => {
    const args = parseArgs(['--script', 'aa', '--script', 'bb']);
    expect(flags(args, 'script')).toEqual(['aa', 'bb']);
  });

  it('returns a single option as a one-item list', () => {
    expect(flags(parseArgs(['--script', 'aa']), 'script')).toEqual(['aa']);
  });

  it('returns an empty list for an absent option', () => {
    expect(flags(parseArgs([]), 'script')).toEqual([]);
  });

  it('treats a trailing option as a boolean', () => {
    const args = parseArgs(['build', '--allow-dirty']);
    expect(boolFlag(args, 'allow-dirty')).toBe(true);
    expect(flag(args, 'allow-dirty')).toBeUndefined();
  });

  it('treats an option followed by another option as a boolean', () => {
    const args = parseArgs(['--dry-run', '--json']);
    expect(boolFlag(args, 'dry-run')).toBe(true);
    expect(boolFlag(args, 'json')).toBe(true);
  });

  it('stops parsing options after a double dash', () => {
    const args = parseArgs(['build', '--', '--not-an-option']);
    expect(args.positional).toEqual(['build', '--not-an-option']);
  });

  it('keeps values containing commas intact', () => {
    expect(flag(parseArgs(['--title', 'Vault, phase two']), 'title')).toBe('Vault, phase two');
  });

  it('reports a missing required option by name', () => {
    expect(() => requireFlag(parseArgs([]), 'report')).toThrow(/--report/);
  });

  it('reports a missing required argument by name', () => {
    expect(() => positional(parseArgs([]), 0, 'attestation')).toThrow(/<attestation>/);
  });
});
