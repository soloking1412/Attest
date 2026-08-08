import { AttestError } from '@attest/core';

/**
 * The PlutusData subset CIP-171 uses, with a hand-written codec so the encoder
 * can emit the indefinite-length byte strings the format requires for payloads
 * over 64 bytes.
 */
export type PlutusData =
  | { readonly kind: 'int'; readonly value: bigint }
  | { readonly kind: 'bytes'; readonly value: Uint8Array }
  | { readonly kind: 'list'; readonly items: readonly PlutusData[] }
  | { readonly kind: 'map'; readonly entries: readonly (readonly [PlutusData, PlutusData])[] }
  | { readonly kind: 'constr'; readonly tag: number; readonly fields: readonly PlutusData[] }
  | { readonly kind: 'null' };

/** Byte strings longer than this must be split across indefinite-length chunks. */
export const BYTE_STRING_CHUNK = 64;

const MAJOR_UINT = 0;
const MAJOR_NINT = 1;
const MAJOR_BYTES = 2;
const MAJOR_ARRAY = 4;
const MAJOR_MAP = 5;
const MAJOR_TAG = 6;
const MAJOR_SIMPLE = 7;

const INDEFINITE = 31;
const BREAK = 0xff;
const NULL = 0xf6;

const CONSTR_BASE_LOW = 121;
const CONSTR_BASE_HIGH = 1280;
const CONSTR_GENERIC = 102;

class Writer {
  private readonly parts: number[] = [];

  head(major: number, value: number | bigint): this {
    const argument = BigInt(value);
    const prefix = major << 5;
    if (argument < 24n) {
      this.parts.push(prefix | Number(argument));
    } else if (argument < 0x100n) {
      this.parts.push(prefix | 24, Number(argument));
    } else if (argument < 0x10000n) {
      this.parts.push(prefix | 25, ...split(argument, 2));
    } else if (argument < 0x100000000n) {
      this.parts.push(prefix | 26, ...split(argument, 4));
    } else if (argument < 0x10000000000000000n) {
      this.parts.push(prefix | 27, ...split(argument, 8));
    } else {
      throw new AttestError('INVALID_ENCODING', 'CBOR argument exceeds 64 bits', { major });
    }
    return this;
  }

  byte(value: number): this {
    this.parts.push(value);
    return this;
  }

  raw(bytes: Uint8Array): this {
    for (const byte of bytes) this.parts.push(byte);
    return this;
  }

  finish(): Uint8Array {
    return Uint8Array.from(this.parts);
  }
}

function split(value: bigint, width: number): number[] {
  const out: number[] = [];
  for (let shift = width - 1; shift >= 0; shift -= 1) {
    out.push(Number((value >> BigInt(shift * 8)) & 0xffn));
  }
  return out;
}

export function encodePlutusData(data: PlutusData): Uint8Array {
  const writer = new Writer();
  write(writer, data);
  return writer.finish();
}

function write(writer: Writer, data: PlutusData): void {
  switch (data.kind) {
    case 'int':
      if (data.value < 0n) writer.head(MAJOR_NINT, -data.value - 1n);
      else writer.head(MAJOR_UINT, data.value);
      return;
    case 'bytes':
      writeBytes(writer, data.value);
      return;
    case 'list':
      writer.head(MAJOR_ARRAY, data.items.length);
      for (const item of data.items) write(writer, item);
      return;
    case 'map':
      writer.head(MAJOR_MAP, data.entries.length);
      for (const [key, value] of data.entries) {
        write(writer, key);
        write(writer, value);
      }
      return;
    case 'constr':
      writer.head(MAJOR_TAG, constrTag(data.tag));
      if (data.tag > 127) {
        writer.head(MAJOR_ARRAY, 2);
        writer.head(MAJOR_UINT, data.tag);
      }
      writer.head(MAJOR_ARRAY, data.fields.length);
      for (const field of data.fields) write(writer, field);
      return;
    case 'null':
      writer.byte(NULL);
      return;
  }
}

function writeBytes(writer: Writer, value: Uint8Array): void {
  if (value.length <= BYTE_STRING_CHUNK) {
    writer.head(MAJOR_BYTES, value.length).raw(value);
    return;
  }
  writer.byte((MAJOR_BYTES << 5) | INDEFINITE);
  for (let offset = 0; offset < value.length; offset += BYTE_STRING_CHUNK) {
    const slice = value.subarray(offset, offset + BYTE_STRING_CHUNK);
    writer.head(MAJOR_BYTES, slice.length).raw(slice);
  }
  writer.byte(BREAK);
}

function constrTag(alternative: number): number {
  if (!Number.isInteger(alternative) || alternative < 0) {
    throw new AttestError(
      'INVALID_ENCODING',
      'Constructor alternative must be a non-negative integer',
      {
        alternative,
      },
    );
  }
  if (alternative <= 6) return CONSTR_BASE_LOW + alternative;
  if (alternative <= 127) return CONSTR_BASE_HIGH + alternative - 7;
  return CONSTR_GENERIC;
}

class Reader {
  private offset = 0;

  constructor(private readonly bytes: Uint8Array) {}

  get done(): boolean {
    return this.offset >= this.bytes.length;
  }

  peek(): number {
    const byte = this.bytes[this.offset];
    if (byte === undefined) {
      throw new AttestError('INVALID_ENCODING', 'Unexpected end of CBOR input');
    }
    return byte;
  }

  next(): number {
    const byte = this.peek();
    this.offset += 1;
    return byte;
  }

  take(length: number): Uint8Array {
    if (this.offset + length > this.bytes.length) {
      throw new AttestError('INVALID_ENCODING', 'CBOR input ended inside a byte string');
    }
    const slice = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return slice;
  }

  argument(additional: number): bigint {
    if (additional < 24) return BigInt(additional);
    const width = additional === 24 ? 1 : additional === 25 ? 2 : additional === 26 ? 4 : 8;
    if (additional > 27) {
      throw new AttestError('INVALID_ENCODING', 'Reserved CBOR additional information', {
        additional,
      });
    }
    let value = 0n;
    for (const byte of this.take(width)) value = (value << 8n) | BigInt(byte);
    return value;
  }
}

export function decodePlutusData(bytes: Uint8Array): PlutusData {
  const reader = new Reader(bytes);
  const value = read(reader);
  if (!reader.done) {
    throw new AttestError('INVALID_ENCODING', 'Trailing bytes after PlutusData value');
  }
  return value;
}

function read(reader: Reader): PlutusData {
  const initial = reader.next();
  const major = initial >> 5;
  const additional = initial & 0x1f;

  switch (major) {
    case MAJOR_UINT:
      return { kind: 'int', value: reader.argument(additional) };
    case MAJOR_NINT:
      return { kind: 'int', value: -1n - reader.argument(additional) };
    case MAJOR_BYTES:
      return { kind: 'bytes', value: readBytes(reader, additional) };
    case MAJOR_ARRAY:
      return { kind: 'list', items: readItems(reader, additional) };
    case MAJOR_MAP:
      return { kind: 'map', entries: readEntries(reader, additional) };
    case MAJOR_TAG:
      return readTagged(reader, Number(reader.argument(additional)));
    case MAJOR_SIMPLE:
      if (initial === NULL) return { kind: 'null' };
      throw new AttestError('INVALID_ENCODING', 'Unsupported CBOR simple value', { initial });
    default:
      throw new AttestError('INVALID_ENCODING', 'Unsupported CBOR major type', { major });
  }
}

function readBytes(reader: Reader, additional: number): Uint8Array {
  if (additional !== INDEFINITE) {
    return reader.take(Number(reader.argument(additional)));
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (reader.peek() !== BREAK) {
    const initial = reader.next();
    if (initial >> 5 !== MAJOR_BYTES) {
      throw new AttestError('INVALID_ENCODING', 'Indefinite byte string contains a foreign chunk');
    }
    const chunk = reader.take(Number(reader.argument(initial & 0x1f)));
    chunks.push(chunk);
    total += chunk.length;
  }
  reader.next();

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function readItems(reader: Reader, additional: number): PlutusData[] {
  const items: PlutusData[] = [];
  if (additional === INDEFINITE) {
    while (reader.peek() !== BREAK) items.push(read(reader));
    reader.next();
    return items;
  }
  const length = Number(reader.argument(additional));
  for (let index = 0; index < length; index += 1) items.push(read(reader));
  return items;
}

function readEntries(reader: Reader, additional: number): (readonly [PlutusData, PlutusData])[] {
  const entries: (readonly [PlutusData, PlutusData])[] = [];
  if (additional === INDEFINITE) {
    while (reader.peek() !== BREAK) entries.push([read(reader), read(reader)] as const);
    reader.next();
    return entries;
  }
  const length = Number(reader.argument(additional));
  for (let index = 0; index < length; index += 1) {
    entries.push([read(reader), read(reader)] as const);
  }
  return entries;
}

function readTagged(reader: Reader, tag: number): PlutusData {
  if (tag === CONSTR_GENERIC) {
    const outer = read(reader);
    if (outer.kind !== 'list' || outer.items.length !== 2) {
      throw new AttestError('INVALID_ENCODING', 'Generic constructor must hold [tag, fields]');
    }
    const [alternative, fields] = outer.items as [PlutusData, PlutusData];
    if (alternative.kind !== 'int' || fields.kind !== 'list') {
      throw new AttestError('INVALID_ENCODING', 'Generic constructor has malformed contents');
    }
    return { kind: 'constr', tag: Number(alternative.value), fields: fields.items };
  }

  const alternative = constrAlternative(tag);
  const fields = read(reader);
  if (fields.kind !== 'list') {
    throw new AttestError('INVALID_ENCODING', 'Constructor fields must be an array', { tag });
  }
  return { kind: 'constr', tag: alternative, fields: fields.items };
}

function constrAlternative(tag: number): number {
  if (tag >= CONSTR_BASE_LOW && tag <= CONSTR_BASE_LOW + 6) return tag - CONSTR_BASE_LOW;
  if (tag >= CONSTR_BASE_HIGH && tag <= CONSTR_BASE_HIGH + 120) {
    return tag - CONSTR_BASE_HIGH + 7;
  }
  throw new AttestError('INVALID_ENCODING', 'CBOR tag is not a PlutusData constructor', { tag });
}
