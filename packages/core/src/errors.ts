export type AttestErrorCode =
  | 'INVALID_DOCUMENT'
  | 'INVALID_ENCODING'
  | 'INVALID_METADATA'
  | 'DIGEST_MISMATCH'
  | 'SAID_MISMATCH'
  | 'UNSUPPORTED_VERSION'
  | 'ANCHOR_NOT_FOUND'
  | 'ISSUER_NOT_AUTHORIZED'
  | 'PROVIDER_ERROR'
  | 'BUILD_FAILED';

export class AttestError extends Error {
  readonly code: AttestErrorCode;
  readonly details: Record<string, unknown>;

  constructor(code: AttestErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'AttestError';
    this.code = code;
    this.details = details;
  }
}

export function invariant(
  condition: unknown,
  code: AttestErrorCode,
  message: string,
  details: Record<string, unknown> = {},
): asserts condition {
  if (!condition) {
    throw new AttestError(code, message, details);
  }
}
