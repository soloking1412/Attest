import { utf8 } from './bytes.js';
import { AttestError } from './errors.js';

export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

const INTEGER_LIKE_KEY = /^(?:0|[1-9][0-9]*)$/;

/**
 * Serialization for documents whose digest is part of their identity.
 *
 * Field order is the order in which keys were inserted, matching KERI, whose
 * SAIDs are computed over field-ordered JSON rather than a sorted form. That
 * order survives `JSON.parse`, so a document read back from disk or from the
 * chain canonicalizes to the bytes it was signed as. Integer-like keys are
 * rejected because JavaScript hoists them ahead of string keys and would break
 * that guarantee.
 */
export function canonicalize(value: JsonValue): string {
  assertCanonical(value, '$');
  return JSON.stringify(value);
}

export function canonicalBytes(value: JsonValue): Uint8Array {
  return utf8(canonicalize(value));
}

function assertCanonical(value: JsonValue, path: string): void {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return;
  }
  if (typeof value === 'number') {
    if (!Number.isInteger(value)) {
      throw new AttestError('INVALID_DOCUMENT', 'Only integer numbers may appear in a document', {
        path,
        value,
      });
    }
    if (!Number.isSafeInteger(value)) {
      throw new AttestError('INVALID_DOCUMENT', 'Number exceeds the safe integer range', {
        path,
        value,
      });
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertCanonical(item, `${path}[${index}]`));
    return;
  }
  if (typeof value !== 'object') {
    throw new AttestError('INVALID_DOCUMENT', 'Unsupported value in document', {
      path,
      type: typeof value,
    });
  }
  for (const [key, item] of Object.entries(value)) {
    if (INTEGER_LIKE_KEY.test(key)) {
      throw new AttestError('INVALID_DOCUMENT', 'Integer-like object keys are not permitted', {
        path,
        key,
      });
    }
    if (item === undefined) {
      throw new AttestError('INVALID_DOCUMENT', 'Undefined values must be omitted', {
        path,
        key,
      });
    }
    assertCanonical(item, `${path}.${key}`);
  }
}

/** Drops keys whose value is `undefined` so optional fields never reach the serializer. */
export function compact<T extends Record<string, unknown>>(value: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined) out[key] = item;
  }
  return out as T;
}
