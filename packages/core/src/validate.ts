import { AttestError } from './errors.js';

export function assertRecord(
  value: unknown,
  field: string,
): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new AttestError('INVALID_DOCUMENT', `Field "${field}" must be an object`, { field });
  }
}

export function assertString(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new AttestError('INVALID_DOCUMENT', `Field "${field}" must be a non-empty string`, {
      field,
    });
  }
}

export function assertHex(
  value: unknown,
  field: string,
  byteLength?: number,
): asserts value is string {
  assertString(value, field);
  if (!/^[0-9a-f]+$/.test(value)) {
    throw new AttestError('INVALID_DOCUMENT', `Field "${field}" must be lowercase hexadecimal`, {
      field,
    });
  }
  if (value.length % 2 !== 0) {
    throw new AttestError('INVALID_DOCUMENT', `Field "${field}" has an odd number of hex digits`, {
      field,
    });
  }
  if (byteLength !== undefined && value.length !== byteLength * 2) {
    throw new AttestError('INVALID_DOCUMENT', `Field "${field}" must be ${byteLength} bytes`, {
      field,
      actual: value.length / 2,
    });
  }
}

export function assertOneOf<T extends string>(
  value: unknown,
  field: string,
  allowed: readonly T[],
): asserts value is T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new AttestError(
      'INVALID_DOCUMENT',
      `Field "${field}" must be one of: ${allowed.join(', ')}`,
      {
        field,
        value,
      },
    );
  }
}

export function assertArray(
  value: unknown,
  field: string,
  minLength = 0,
): asserts value is unknown[] {
  if (!Array.isArray(value) || value.length < minLength) {
    throw new AttestError(
      'INVALID_DOCUMENT',
      `Field "${field}" must be an array of at least ${minLength} item(s)`,
      { field },
    );
  }
}

export function assertCount(value: unknown, field: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new AttestError('INVALID_DOCUMENT', `Field "${field}" must be a non-negative integer`, {
      field,
      value,
    });
  }
}

/** Accepts the git remote forms a build can be reproduced from. */
export function assertRepositoryUrl(value: unknown, field: string): asserts value is string {
  assertString(value, field);
  const supported = /^(https?:\/\/|git@|ssh:\/\/|git:\/\/)/.test(value);
  if (!supported) {
    throw new AttestError('INVALID_DOCUMENT', `Field "${field}" must be a git-resolvable URL`, {
      field,
      value,
    });
  }
}

export function optional<T>(
  value: unknown,
  assertion: (input: unknown) => asserts input is T,
): T | undefined {
  if (value === undefined || value === null) return undefined;
  assertion(value);
  return value;
}
