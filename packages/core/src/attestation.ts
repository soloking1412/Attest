import { assertAid, assertDigest } from './cesr.js';
import { assertTimestamp, now } from './datetime.js';
import type { DigestAlgorithm } from './digest.js';
import { AttestError } from './errors.js';
import { saidify, verifySaid } from './said.js';
import { formatVersion, parseVersion } from './version.js';
import {
  assertArray,
  assertCount,
  assertHex,
  assertOneOf,
  assertRecord,
  assertRepositoryUrl,
  assertString,
} from './validate.js';

export const ATTESTATION_TYPES = ['build', 'audit', 'release', 'revocation'] as const;
export type AttestationType = (typeof ATTESTATION_TYPES)[number];

export const PLUTUS_VERSIONS = ['v1', 'v2', 'v3'] as const;
export type PlutusVersion = (typeof PLUTUS_VERSIONS)[number];

export const NETWORKS = ['mainnet', 'preprod', 'preview'] as const;
export type Network = (typeof NETWORKS)[number];

/** Compiler names, matching the registry CIP-171 assigns constructor ids to. */
export const COMPILERS = ['aiken', 'plutarch', 'plutustx', 'scalus', 'plu-ts', 'opshin'] as const;
export type Compiler = (typeof COMPILERS)[number];

export const AUDIT_OUTCOMES = ['clean', 'findings-resolved', 'findings-open', 'failed'] as const;
export type AuditOutcome = (typeof AUDIT_OUTCOMES)[number];

export const REVOCATION_REASONS = ['compromised', 'superseded', 'erroneous', 'withdrawn'] as const;
export type RevocationReason = (typeof REVOCATION_REASONS)[number];

export const SCRIPT_HASH_BYTES = 28;
export const COMMIT_BYTES = 20;

export interface ScriptRef {
  /** Blake2b-224 script hash, as it appears on chain. */
  readonly hash: string;
  readonly plutusVersion: PlutusVersion;
  /** Validator title from the blueprint, for human reference only. */
  readonly title?: string;
}

export interface SourceRef {
  readonly url: string;
  readonly commit: string;
  readonly path?: string;
}

export interface CompilerRef {
  readonly name: Compiler;
  readonly version: string;
}

export interface Envelope {
  readonly v: string;
  readonly d: string;
  readonly t: AttestationType;
  /** Issuer's KERI autonomic identifier. */
  readonly i: string;
  /** Credential registry the issuer's authority derives from, when applicable. */
  readonly ri?: string;
  readonly dt: string;
}

export interface BuildBody {
  readonly script: ScriptRef;
  readonly source: SourceRef;
  readonly compiler: CompilerRef;
  /** CESR digest of the CIP-57 blueprint the script hash was read from. */
  readonly blueprint: string;
  /** Applied parameters, CBOR-encoded PlutusData, in application order. */
  readonly parameters?: readonly string[];
  /** Pinned build environment, such as a container image digest. */
  readonly environment?: Readonly<Record<string, string>>;
}

export interface AuditBody {
  readonly scripts: readonly ScriptRef[];
  readonly source: SourceRef;
  readonly report: {
    readonly title: string;
    readonly digest: string;
    readonly uri?: string;
  };
  readonly outcome: AuditOutcome;
  readonly findings?: {
    readonly critical: number;
    readonly high: number;
    readonly medium: number;
    readonly low: number;
    readonly informational: number;
  };
}

export interface ReleaseBody {
  readonly project: string;
  readonly version: string;
  readonly network: Network;
  readonly scripts: readonly ScriptRef[];
  /** SAIDs of the build and audit attestations this release stands on. */
  readonly includes: readonly string[];
}

export interface RevocationBody {
  /** SAID of the attestation being withdrawn. */
  readonly target: string;
  readonly reason: RevocationReason;
  readonly note?: string;
}

export interface BuildAttestation extends Envelope {
  readonly t: 'build';
  readonly a: BuildBody;
}

export interface AuditAttestation extends Envelope {
  readonly t: 'audit';
  readonly a: AuditBody;
}

export interface ReleaseAttestation extends Envelope {
  readonly t: 'release';
  readonly a: ReleaseBody;
}

export interface RevocationAttestation extends Envelope {
  readonly t: 'revocation';
  readonly a: RevocationBody;
}

export type Attestation =
  BuildAttestation | AuditAttestation | ReleaseAttestation | RevocationAttestation;

export interface IssueOptions {
  readonly issuer: string;
  readonly registry?: string;
  readonly at?: Date;
  readonly algorithm?: DigestAlgorithm;
}

export function createBuildAttestation(body: BuildBody, options: IssueOptions): BuildAttestation {
  return issue('build', body, options);
}

export function createAuditAttestation(body: AuditBody, options: IssueOptions): AuditAttestation {
  return issue('audit', body, options);
}

export function createReleaseAttestation(
  body: ReleaseBody,
  options: IssueOptions,
): ReleaseAttestation {
  return issue('release', body, options);
}

export function createRevocationAttestation(
  body: RevocationBody,
  options: IssueOptions,
): RevocationAttestation {
  return issue('revocation', body, options);
}

function issue<T extends AttestationType, B>(
  type: T,
  body: B,
  options: IssueOptions,
): Extract<Attestation, { t: T }> {
  assertAid(options.issuer, 'i');
  if (options.registry !== undefined) assertDigest(options.registry, 'ri');

  const draft = {
    v: formatVersion(0),
    d: '',
    t: type,
    i: options.issuer,
    ...(options.registry !== undefined ? { ri: options.registry } : {}),
    dt: now(options.at),
    a: body,
  };

  const attestation = saidify(draft, options.algorithm) as unknown as Extract<
    Attestation,
    { t: T }
  >;
  assertAttestation(attestation);
  return attestation;
}

/** Parses and fully validates a serialized attestation, including its SAID. */
export function parseAttestation(input: string | unknown): Attestation {
  const value: unknown = typeof input === 'string' ? JSON.parse(input) : input;
  assertAttestation(value);
  verifySaid(value);
  return value;
}

export function assertAttestation(value: unknown): asserts value is Attestation {
  assertRecord(value, '$');
  assertString(value.v, 'v');
  parseVersion(value.v);
  assertDigest(value.d, 'd');
  assertOneOf(value.t, 't', ATTESTATION_TYPES);
  assertAid(value.i, 'i');
  if (value.ri !== undefined) assertDigest(value.ri, 'ri');
  assertTimestamp(value.dt, 'dt');
  assertRecord(value.a, 'a');

  switch (value.t) {
    case 'build':
      assertBuildBody(value.a);
      return;
    case 'audit':
      assertAuditBody(value.a);
      return;
    case 'release':
      assertReleaseBody(value.a);
      return;
    case 'revocation':
      assertRevocationBody(value.a);
      return;
    default:
      throw new AttestError('INVALID_DOCUMENT', 'Unhandled attestation type', { type: value.t });
  }
}

export function assertScriptRef(value: unknown, field: string): asserts value is ScriptRef {
  assertRecord(value, field);
  assertHex(value.hash, `${field}.hash`, SCRIPT_HASH_BYTES);
  assertOneOf(value.plutusVersion, `${field}.plutusVersion`, PLUTUS_VERSIONS);
  if (value.title !== undefined) assertString(value.title, `${field}.title`);
}

export function assertSourceRef(value: unknown, field: string): asserts value is SourceRef {
  assertRecord(value, field);
  assertRepositoryUrl(value.url, `${field}.url`);
  assertHex(value.commit, `${field}.commit`, COMMIT_BYTES);
  if (value.path !== undefined) assertString(value.path, `${field}.path`);
}

function assertCompilerRef(value: unknown, field: string): asserts value is CompilerRef {
  assertRecord(value, field);
  assertOneOf(value.name, `${field}.name`, COMPILERS);
  assertString(value.version, `${field}.version`);
}

function assertBuildBody(value: unknown): asserts value is BuildBody {
  assertRecord(value, 'a');
  assertScriptRef(value.script, 'a.script');
  assertSourceRef(value.source, 'a.source');
  assertCompilerRef(value.compiler, 'a.compiler');
  assertDigest(value.blueprint, 'a.blueprint');
  if (value.parameters !== undefined) {
    assertArray(value.parameters, 'a.parameters');
    value.parameters.forEach((item, index) => assertHex(item, `a.parameters[${index}]`));
  }
  if (value.environment !== undefined) {
    assertRecord(value.environment, 'a.environment');
    for (const [key, item] of Object.entries(value.environment)) {
      assertString(item, `a.environment.${key}`);
    }
  }
}

function assertAuditBody(value: unknown): asserts value is AuditBody {
  assertRecord(value, 'a');
  assertArray(value.scripts, 'a.scripts', 1);
  value.scripts.forEach((item, index) => assertScriptRef(item, `a.scripts[${index}]`));
  assertSourceRef(value.source, 'a.source');
  assertRecord(value.report, 'a.report');
  assertString(value.report.title, 'a.report.title');
  assertDigest(value.report.digest, 'a.report.digest');
  if (value.report.uri !== undefined) assertString(value.report.uri, 'a.report.uri');
  assertOneOf(value.outcome, 'a.outcome', AUDIT_OUTCOMES);
  if (value.findings !== undefined) {
    assertRecord(value.findings, 'a.findings');
    for (const severity of ['critical', 'high', 'medium', 'low', 'informational'] as const) {
      assertCount(value.findings[severity], `a.findings.${severity}`);
    }
  }
}

function assertReleaseBody(value: unknown): asserts value is ReleaseBody {
  assertRecord(value, 'a');
  assertString(value.project, 'a.project');
  assertString(value.version, 'a.version');
  assertOneOf(value.network, 'a.network', NETWORKS);
  assertArray(value.scripts, 'a.scripts', 1);
  value.scripts.forEach((item, index) => assertScriptRef(item, `a.scripts[${index}]`));
  assertArray(value.includes, 'a.includes');
  value.includes.forEach((item, index) => assertDigest(item, `a.includes[${index}]`));
}

function assertRevocationBody(value: unknown): asserts value is RevocationBody {
  assertRecord(value, 'a');
  assertDigest(value.target, 'a.target');
  assertOneOf(value.reason, 'a.reason', REVOCATION_REASONS);
  if (value.note !== undefined) assertString(value.note, 'a.note');
}

/** Every script hash an attestation makes a claim about. */
export function subjectScripts(attestation: Attestation): readonly ScriptRef[] {
  switch (attestation.t) {
    case 'build':
      return [attestation.a.script];
    case 'audit':
    case 'release':
      return attestation.a.scripts;
    case 'revocation':
      return [];
  }
}
