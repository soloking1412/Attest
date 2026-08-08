import {
  assertAid,
  assertDigest,
  assertRecord,
  assertString,
  AttestError,
  parseSequence,
} from '@attest/core';

/** Establishment events; anything else cannot change the key state. */
export const ESTABLISHMENT_TYPES = ['icp', 'rot', 'dip', 'drt'] as const;

export const EVENT_TYPES = [...ESTABLISHMENT_TYPES, 'ixn'] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/** A seal committing a key event to external data. */
export interface Seal {
  readonly d?: string;
  readonly i?: string;
  readonly s?: string;
}

export interface KeyEvent {
  /** Identifier of the event itself. */
  readonly said: string;
  readonly type: EventType;
  /** Identifier the log belongs to. */
  readonly identifier: string;
  /** Sequence number, lowercase hex. */
  readonly sequence: string;
  /** Identifier of the previous event, absent on inception. */
  readonly prior?: string;
  readonly anchors: readonly Seal[];
}

export interface AnchorQuery {
  readonly identifier: string;
  readonly sequence: string;
  readonly said: string;
}

/**
 * Reads a key event dictionary as returned by a KERI agent.
 *
 * This module establishes only that a log is well formed and that it commits to
 * a digest. Whether the log is authentic — that its signatures meet the
 * issuer's thresholds and its witnesses have receipted it — is settled by the
 * agent or watcher network that produced it, which is where that verification
 * belongs.
 */
export function parseKeyEvent(value: unknown): KeyEvent {
  assertRecord(value, 'ked');
  assertString(value.t, 'ked.t');
  if (!(EVENT_TYPES as readonly string[]).includes(value.t)) {
    throw new AttestError('INVALID_DOCUMENT', 'Unsupported key event type', { type: value.t });
  }
  assertDigest(value.d, 'ked.d');
  assertAid(value.i, 'ked.i');
  assertString(value.s, 'ked.s');
  parseSequence(value.s);

  return {
    said: value.d,
    type: value.t as EventType,
    identifier: value.i,
    sequence: value.s,
    ...(typeof value.p === 'string' && value.p.length > 0 ? { prior: value.p } : {}),
    anchors: readSeals(value.a),
  };
}

/** Reads a log from the `{ ked, atc }` records a KERIA agent returns. */
export function parseKeyEventLog(records: unknown): KeyEvent[] {
  if (!Array.isArray(records)) {
    throw new AttestError('INVALID_DOCUMENT', 'Key event log must be an array');
  }
  return records.map((record) => {
    if (record !== null && typeof record === 'object' && 'ked' in record) {
      return parseKeyEvent((record as { ked: unknown }).ked);
    }
    return parseKeyEvent(record);
  });
}

export function findEvent(log: readonly KeyEvent[], sequence: string): KeyEvent | undefined {
  const target = parseSequence(sequence);
  return log.find((event) => parseSequence(event.sequence) === target);
}

export function anchorsDigest(event: KeyEvent, said: string): boolean {
  return event.anchors.some((seal) => seal.d === said);
}

/**
 * Confirms the log commits to `said` at the stated sequence number.
 *
 * A digest that appears at a different sequence number is treated as absent:
 * the on-chain record names one specific event, and accepting any other would
 * let a later transaction point at an earlier commitment.
 */
export function assertAnchored(log: readonly KeyEvent[], query: AnchorQuery): KeyEvent {
  assertContiguous(log, query.identifier);

  const event = findEvent(log, query.sequence);
  if (event === undefined) {
    throw new AttestError(
      'ANCHOR_NOT_FOUND',
      'Key event log has no event at that sequence number',
      {
        identifier: query.identifier,
        sequence: query.sequence,
        length: log.length,
      },
    );
  }
  if (event.identifier !== query.identifier) {
    throw new AttestError('ANCHOR_NOT_FOUND', 'Key event belongs to a different identifier', {
      expected: query.identifier,
      actual: event.identifier,
    });
  }
  if (!anchorsDigest(event, query.said)) {
    throw new AttestError('ANCHOR_NOT_FOUND', 'Key event does not commit to that digest', {
      identifier: query.identifier,
      sequence: query.sequence,
      said: query.said,
      anchors: event.anchors.map((seal) => seal.d).filter(Boolean),
    });
  }
  return event;
}

/** Checks the log is a single unbroken chain for one identifier. */
export function assertContiguous(log: readonly KeyEvent[], identifier?: string): void {
  if (log.length === 0) {
    throw new AttestError('ANCHOR_NOT_FOUND', 'Key event log is empty', { identifier });
  }

  const sorted = [...log].sort((a, b) =>
    Number(parseSequence(a.sequence) - parseSequence(b.sequence)),
  );
  const first = sorted[0] as KeyEvent;

  if (parseSequence(first.sequence) !== 0n) {
    throw new AttestError('INVALID_DOCUMENT', 'Key event log does not start at inception', {
      sequence: first.sequence,
    });
  }
  if (identifier !== undefined && first.identifier !== identifier) {
    throw new AttestError('INVALID_DOCUMENT', 'Key event log belongs to a different identifier', {
      expected: identifier,
      actual: first.identifier,
    });
  }

  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1] as KeyEvent;
    const current = sorted[index] as KeyEvent;

    if (parseSequence(current.sequence) !== parseSequence(previous.sequence) + 1n) {
      throw new AttestError('INVALID_DOCUMENT', 'Key event log has a gap', {
        after: previous.sequence,
        next: current.sequence,
      });
    }
    if (current.prior !== previous.said) {
      throw new AttestError('INVALID_DOCUMENT', 'Key event does not chain to its predecessor', {
        sequence: current.sequence,
      });
    }
    if (current.identifier !== previous.identifier) {
      throw new AttestError('INVALID_DOCUMENT', 'Key event log mixes identifiers', {
        sequence: current.sequence,
      });
    }
  }
}

/** Every digest the log commits to, in sequence order. */
export function anchoredDigests(log: readonly KeyEvent[]): string[] {
  return [...log]
    .sort((a, b) => Number(parseSequence(a.sequence) - parseSequence(b.sequence)))
    .flatMap((event) => event.anchors.map((seal) => seal.d))
    .filter((digest): digest is string => typeof digest === 'string');
}

function readSeals(value: unknown): Seal[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return [];

  const seals: Seal[] = [];
  for (const entry of value) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const seal = entry as Record<string, unknown>;
    seals.push({
      ...(typeof seal.d === 'string' ? { d: seal.d } : {}),
      ...(typeof seal.i === 'string' ? { i: seal.i } : {}),
      ...(typeof seal.s === 'string' ? { s: seal.s } : {}),
    });
  }
  return seals;
}
