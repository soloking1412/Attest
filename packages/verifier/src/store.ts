import { DatabaseSync } from 'node:sqlite';

import { serialize, subjectScripts, type Attestation, type AttestationType } from '@attest/core';

import type { Check, RevocationIndex, Verdict, VerificationReport } from './verify.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS attestations (
  said        TEXT PRIMARY KEY,
  type        TEXT NOT NULL,
  issuer      TEXT NOT NULL,
  sequence    TEXT NOT NULL,
  verdict     TEXT NOT NULL,
  document    TEXT,
  tx_hash     TEXT NOT NULL,
  slot        INTEGER NOT NULL,
  height      INTEGER NOT NULL,
  block_time  INTEGER NOT NULL,
  checks      TEXT NOT NULL,
  indexed_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS attestations_issuer ON attestations (issuer);
CREATE INDEX IF NOT EXISTS attestations_type ON attestations (type);
CREATE INDEX IF NOT EXISTS attestations_height ON attestations (height DESC);

CREATE TABLE IF NOT EXISTS script_attestations (
  script_hash TEXT NOT NULL,
  said        TEXT NOT NULL,
  PRIMARY KEY (script_hash, said)
);
CREATE INDEX IF NOT EXISTS script_attestations_hash ON script_attestations (script_hash);

CREATE TABLE IF NOT EXISTS revocations (
  target TEXT NOT NULL,
  said   TEXT NOT NULL,
  issuer TEXT NOT NULL,
  PRIMARY KEY (target, said)
);

CREATE TABLE IF NOT EXISTS cursors (
  label      INTEGER PRIMARY KEY,
  page       INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
`;

export interface StoredAttestation {
  readonly said: string;
  readonly type: AttestationType | string;
  readonly issuer: string;
  readonly sequence: string;
  readonly verdict: Verdict;
  readonly attestation?: Attestation;
  readonly transaction: {
    readonly hash: string;
    readonly slot: number;
    readonly height: number;
    readonly time: number;
  };
  readonly checks: readonly Check[];
  readonly revoked: boolean;
}

interface AttestationRow {
  said: string;
  type: string;
  issuer: string;
  sequence: string;
  verdict: string;
  document: string | null;
  tx_hash: string;
  slot: number;
  height: number;
  block_time: number;
  checks: string;
  revoked: number;
}

/**
 * A revocation only counts when it comes from the identifier that issued the
 * attestation it names. Joining on the issuer at read time makes that hold
 * however the two transactions are ordered on chain.
 */
const REVOKED_JOIN = `
  EXISTS (
    SELECT 1 FROM revocations r
    WHERE r.target = a.said AND r.issuer = a.issuer
  ) AS revoked
`;

export class AttestationStore implements RevocationIndex {
  private readonly db: DatabaseSync;

  constructor(path = ':memory:') {
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA foreign_keys = ON');
    this.db.exec(SCHEMA);
  }

  record(report: VerificationReport): void {
    if (report.digest === undefined || report.issuer === undefined) return;

    const attestation = report.attestation;
    this.db
      .prepare(
        `INSERT INTO attestations
           (said, type, issuer, sequence, verdict, document, tx_hash, slot, height, block_time, checks, indexed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(said) DO UPDATE SET
           verdict = excluded.verdict,
           document = COALESCE(excluded.document, attestations.document),
           checks = excluded.checks,
           indexed_at = excluded.indexed_at`,
      )
      .run(
        report.digest,
        attestation?.t ?? 'unknown',
        report.issuer,
        report.sequence ?? '0',
        report.verdict,
        attestation === undefined ? null : serialize(attestation),
        report.transaction.hash,
        report.transaction.slot,
        report.transaction.height,
        report.transaction.time,
        JSON.stringify(report.checks),
        Date.now(),
      );

    if (attestation === undefined) return;

    const link = this.db.prepare(
      'INSERT INTO script_attestations (script_hash, said) VALUES (?, ?) ON CONFLICT DO NOTHING',
    );
    for (const script of subjectScripts(attestation)) {
      link.run(script.hash, report.digest);
    }

    if (attestation.t === 'revocation') {
      this.db
        .prepare(
          'INSERT INTO revocations (target, said, issuer) VALUES (?, ?, ?) ON CONFLICT DO NOTHING',
        )
        .run(attestation.a.target, attestation.d, attestation.i);
    }
  }

  get(said: string): StoredAttestation | undefined {
    const row = this.db
      .prepare(`SELECT a.*, ${REVOKED_JOIN} FROM attestations a WHERE a.said = ?`)
      .get(said) as unknown as AttestationRow | undefined;
    return row === undefined ? undefined : hydrate(row);
  }

  byScript(scriptHash: string): StoredAttestation[] {
    return this.query(
      `SELECT a.*, ${REVOKED_JOIN} FROM attestations a
         JOIN script_attestations s ON s.said = a.said
        WHERE s.script_hash = ?
        ORDER BY a.height DESC`,
      scriptHash,
    );
  }

  byIssuer(issuer: string, limit = 100): StoredAttestation[] {
    return this.query(
      `SELECT a.*, ${REVOKED_JOIN} FROM attestations a
        WHERE a.issuer = ? ORDER BY a.height DESC LIMIT ?`,
      issuer,
      limit,
    );
  }

  recent(limit = 50): StoredAttestation[] {
    return this.query(
      `SELECT a.*, ${REVOKED_JOIN} FROM attestations a ORDER BY a.height DESC LIMIT ?`,
      limit,
    );
  }

  isRevoked(said: string): boolean {
    const row = this.db
      .prepare(
        `SELECT 1 AS found FROM revocations r
           JOIN attestations a ON a.said = r.target
          WHERE r.target = ? AND r.issuer = a.issuer`,
      )
      .get(said);
    return row !== undefined;
  }

  cursor(label: number): number | undefined {
    const row = this.db
      .prepare('SELECT page FROM cursors WHERE label = ?')
      .get(label) as unknown as { page: number } | undefined;
    return row?.page;
  }

  setCursor(label: number, page: number): void {
    this.db
      .prepare(
        `INSERT INTO cursors (label, page, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(label) DO UPDATE SET page = excluded.page, updated_at = excluded.updated_at`,
      )
      .run(label, page, Date.now());
  }

  stats(): { total: number; verified: number; revoked: number; issuers: number } {
    const row = this.db
      .prepare(
        `SELECT
           COUNT(*) AS total,
           SUM(CASE WHEN verdict = 'verified' THEN 1 ELSE 0 END) AS verified,
           COUNT(DISTINCT issuer) AS issuers
         FROM attestations`,
      )
      .get() as unknown as { total: number; verified: number | null; issuers: number };
    const revoked = this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM revocations r
           JOIN attestations a ON a.said = r.target AND a.issuer = r.issuer`,
      )
      .get() as unknown as { n: number };

    return {
      total: row.total,
      verified: row.verified ?? 0,
      revoked: revoked.n,
      issuers: row.issuers,
    };
  }

  close(): void {
    this.db.close();
  }

  private query(sql: string, ...params: (string | number)[]): StoredAttestation[] {
    // node:sqlite types rows as Record<string, SQLOutputValue>; the shape is
    // fixed by the schema above and checked by the tests, not by the driver.
    const rows = this.db.prepare(sql).all(...params) as unknown as AttestationRow[];
    return rows.map(hydrate);
  }
}

function hydrate(row: AttestationRow): StoredAttestation {
  return {
    said: row.said,
    type: row.type,
    issuer: row.issuer,
    sequence: row.sequence,
    verdict: row.verdict as Verdict,
    ...(row.document !== null ? { attestation: JSON.parse(row.document) as Attestation } : {}),
    transaction: {
      hash: row.tx_hash,
      slot: row.slot,
      height: row.height,
      time: row.block_time,
    },
    checks: JSON.parse(row.checks) as Check[],
    revoked: row.revoked === 1,
  };
}
