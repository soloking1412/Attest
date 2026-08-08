import { describe, expect, it } from 'vitest';

import { canonicalize, compact } from './canonical.js';
import { AttestError } from './errors.js';

describe('canonical serialization', () => {
  it('preserves field order rather than sorting', () => {
    expect(canonicalize({ v: 1, d: 2, a: 3 })).toBe('{"v":1,"d":2,"a":3}');
  });

  it('emits no whitespace', () => {
    expect(canonicalize({ a: [1, 2], b: { c: 'd' } })).toBe('{"a":[1,2],"b":{"c":"d"}}');
  });

  it('rejects integer-like keys, which JavaScript would reorder', () => {
    expect(() => canonicalize({ b: 1, '0': 2 })).toThrow(/Integer-like/);
  });

  it('rejects non-integer numbers', () => {
    expect(() => canonicalize({ a: 1.5 })).toThrow(AttestError);
  });

  it('rejects numbers outside the safe integer range', () => {
    expect(() => canonicalize({ a: Number.MAX_SAFE_INTEGER + 2 })).toThrow(/safe integer/);
  });

  it('rejects undefined rather than silently dropping it', () => {
    expect(() => canonicalize({ a: undefined } as never)).toThrow(/must be omitted/);
  });

  it('drops undefined values through compact', () => {
    expect(compact({ a: 1, b: undefined })).toEqual({ a: 1 });
  });
});
