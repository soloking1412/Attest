import { AttestError } from './errors.js';

const KERI_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}[+-]\d{2}:\d{2}$/;

/** KERI-style timestamp: ISO-8601 with microsecond precision and an explicit offset. */
export function now(at: Date = new Date()): string {
  return format(at);
}

export function format(at: Date): string {
  const iso = at.toISOString();
  return `${iso.slice(0, 19)}.${iso.slice(20, 23)}000+00:00`;
}

export function parse(value: string): Date {
  assertTimestamp(value, 'dt');
  const normalized = `${value.slice(0, 23)}${value.slice(26)}`;
  const at = new Date(normalized);
  if (Number.isNaN(at.getTime())) {
    throw new AttestError('INVALID_DOCUMENT', 'Timestamp is not a valid date', { value });
  }
  return at;
}

export function assertTimestamp(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || !KERI_DATETIME.test(value)) {
    throw new AttestError('INVALID_DOCUMENT', `Field "${field}" is not a KERI timestamp`, {
      value,
    });
  }
}
