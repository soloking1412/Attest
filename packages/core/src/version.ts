import { AttestError } from './errors.js';

export const PROTOCOL = 'ATST';
export const PROTOCOL_VERSION = '10';
export const SERIALIZATION_KIND = 'JSON';

/** `ATST10JSON000000_` — protocol, version, kind, six hex size digits, terminator. */
export const VERSION_STRING_LENGTH = 17;

const VERSION_PATTERN = /^([A-Z]{4})([0-9a-f]{2})([A-Z]{4})([0-9a-f]{6})_$/;

export const MAX_DOCUMENT_SIZE = 0xffffff;

export interface DocumentVersion {
  readonly protocol: string;
  readonly version: string;
  readonly kind: string;
  readonly size: number;
}

export function formatVersion(size: number): string {
  if (!Number.isInteger(size) || size < 0 || size > MAX_DOCUMENT_SIZE) {
    throw new AttestError('INVALID_DOCUMENT', 'Document size is out of range', { size });
  }
  return `${PROTOCOL}${PROTOCOL_VERSION}${SERIALIZATION_KIND}${size.toString(16).padStart(6, '0')}_`;
}

export function parseVersion(value: string): DocumentVersion {
  const match = VERSION_PATTERN.exec(value);
  if (!match) {
    throw new AttestError('UNSUPPORTED_VERSION', 'Malformed version string', { value });
  }
  const [, protocol, version, kind, size] = match as unknown as [
    string,
    string,
    string,
    string,
    string,
  ];
  if (protocol !== PROTOCOL) {
    throw new AttestError('UNSUPPORTED_VERSION', 'Unexpected protocol in version string', {
      protocol,
    });
  }
  if (kind !== SERIALIZATION_KIND) {
    throw new AttestError('UNSUPPORTED_VERSION', 'Unsupported serialization kind', { kind });
  }
  if (version !== PROTOCOL_VERSION) {
    throw new AttestError('UNSUPPORTED_VERSION', 'Unsupported protocol version', { version });
  }
  return { protocol, version, kind, size: Number.parseInt(size, 16) };
}
