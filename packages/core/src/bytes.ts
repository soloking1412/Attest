import { AttestError } from './errors.js';

const HEX_PATTERN = /^(?:[0-9a-fA-F]{2})*$/;

export function fromHex(value: string): Uint8Array {
  if (!HEX_PATTERN.test(value)) {
    throw new AttestError('INVALID_ENCODING', 'Value is not valid hexadecimal', {
      length: value.length,
    });
  }
  const out = new Uint8Array(value.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(value.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) {
    out += byte.toString(16).padStart(2, '0');
  }
  return out;
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function equal(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= (a[i] as number) ^ (b[i] as number);
  }
  return diff === 0;
}

export function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

export function fromUtf8(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

const B64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export function toBase64Url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] as number;
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += B64URL_ALPHABET[b0 >> 2];
    if (b1 === undefined) {
      out += B64URL_ALPHABET[(b0 & 0x03) << 4];
      break;
    }
    out += B64URL_ALPHABET[((b0 & 0x03) << 4) | (b1 >> 4)];
    if (b2 === undefined) {
      out += B64URL_ALPHABET[(b1 & 0x0f) << 2];
      break;
    }
    out += B64URL_ALPHABET[((b1 & 0x0f) << 2) | (b2 >> 6)];
    out += B64URL_ALPHABET[b2 & 0x3f];
  }
  return out;
}

const B64URL_LOOKUP = (() => {
  const table = new Int8Array(128).fill(-1);
  for (let i = 0; i < B64URL_ALPHABET.length; i += 1) {
    table[B64URL_ALPHABET.charCodeAt(i)] = i;
  }
  return table;
})();

export function fromBase64Url(value: string): Uint8Array {
  const bits: number[] = [];
  for (const char of value) {
    const code = char.charCodeAt(0);
    const index = code < 128 ? (B64URL_LOOKUP[code] as number) : -1;
    if (index < 0) {
      throw new AttestError('INVALID_ENCODING', 'Value is not valid base64url', { char });
    }
    bits.push(index);
  }
  const out = new Uint8Array(Math.floor((bits.length * 6) / 8));
  let accumulator = 0;
  let held = 0;
  let cursor = 0;
  for (const value6 of bits) {
    accumulator = (accumulator << 6) | value6;
    held += 6;
    if (held >= 8) {
      held -= 8;
      out[cursor] = (accumulator >> held) & 0xff;
      cursor += 1;
    }
  }
  return out;
}
