import {
  assertArray,
  assertHex,
  assertOneOf,
  assertRecord,
  assertString,
  AttestError,
  COMPILERS,
  PLUTUS_VERSIONS,
  qb64Digest,
  SCRIPT_HASH_BYTES,
  type Compiler,
  type CompilerRef,
  type DigestAlgorithm,
  type PlutusVersion,
  type ScriptRef,
} from '@attest/core';

import { computeScriptHash, inferPlutusVersion } from './scripthash.js';

export interface BlueprintPreamble {
  readonly title: string;
  readonly version: string;
  readonly plutusVersion: PlutusVersion;
  readonly description?: string;
  readonly license?: string;
  readonly compiler?: { readonly name: string; readonly version: string };
}

export interface BlueprintValidator {
  readonly title: string;
  readonly compiledCode: string;
  readonly hash?: string;
  /** Present when the validator must be applied to parameters before deployment. */
  readonly parameterized: boolean;
}

export interface Blueprint {
  readonly preamble: BlueprintPreamble;
  readonly validators: readonly BlueprintValidator[];
}

/** Blueprint compiler names mapped onto the identifiers CIP-171 registers. */
const COMPILER_ALIASES: Readonly<Record<string, Compiler>> = {
  aiken: 'aiken',
  plutarch: 'plutarch',
  plutustx: 'plutustx',
  'plutus-tx': 'plutustx',
  plutus: 'plutustx',
  scalus: 'scalus',
  'plu-ts': 'plu-ts',
  pluts: 'plu-ts',
  opshin: 'opshin',
};

export function parseBlueprint(input: string | unknown): Blueprint {
  const value: unknown = typeof input === 'string' ? JSON.parse(input) : input;
  assertRecord(value, 'blueprint');
  assertRecord(value.preamble, 'preamble');

  const preamble = value.preamble;
  assertString(preamble.title, 'preamble.title');
  assertString(preamble.version, 'preamble.version');
  assertOneOf(preamble.plutusVersion, 'preamble.plutusVersion', PLUTUS_VERSIONS);

  let compiler: BlueprintPreamble['compiler'];
  if (preamble.compiler !== undefined) {
    assertRecord(preamble.compiler, 'preamble.compiler');
    assertString(preamble.compiler.name, 'preamble.compiler.name');
    assertString(preamble.compiler.version, 'preamble.compiler.version');
    compiler = { name: preamble.compiler.name, version: preamble.compiler.version };
  }

  assertArray(value.validators, 'validators', 1);
  const validators = value.validators.map((entry, index) => readValidator(entry, index));

  return {
    preamble: {
      title: preamble.title,
      version: preamble.version,
      plutusVersion: preamble.plutusVersion,
      ...(typeof preamble.description === 'string' ? { description: preamble.description } : {}),
      ...(typeof preamble.license === 'string' ? { license: preamble.license } : {}),
      ...(compiler !== undefined ? { compiler } : {}),
    },
    validators,
  };
}

function readValidator(entry: unknown, index: number): BlueprintValidator {
  const field = `validators[${index}]`;
  assertRecord(entry, field);
  assertString(entry.title, `${field}.title`);
  assertHex(entry.compiledCode, `${field}.compiledCode`);
  if (entry.hash !== undefined) assertHex(entry.hash, `${field}.hash`, SCRIPT_HASH_BYTES);

  return {
    title: entry.title,
    compiledCode: entry.compiledCode,
    ...(typeof entry.hash === 'string' ? { hash: entry.hash } : {}),
    parameterized: Array.isArray(entry.parameters) && entry.parameters.length > 0,
  };
}

/**
 * Script references for every validator in the blueprint, deduplicated by hash.
 *
 * A hash declared by the blueprint is recomputed and must agree; a blueprint
 * whose stated hash does not follow from its own bytecode is rejected rather
 * than trusted, since it is the only place the two can be cross-checked.
 */
export function blueprintScripts(blueprint: Blueprint): readonly ScriptRef[] {
  const seen = new Map<string, ScriptRef>();

  for (const validator of blueprint.validators) {
    const hash = computeScriptHash(validator.compiledCode, blueprint.preamble.plutusVersion);
    if (validator.hash !== undefined && validator.hash !== hash) {
      throw new AttestError('DIGEST_MISMATCH', 'Blueprint hash does not match its compiled code', {
        validator: validator.title,
        declared: validator.hash,
        computed: hash,
        matchesUnder: inferPlutusVersion(validator.compiledCode, validator.hash),
      });
    }
    if (!seen.has(hash)) {
      seen.set(hash, {
        hash,
        plutusVersion: blueprint.preamble.plutusVersion,
        title: validator.title,
      });
    }
  }

  return [...seen.values()];
}

export function findValidator(blueprint: Blueprint, title: string): BlueprintValidator {
  const exact = blueprint.validators.find((validator) => validator.title === title);
  if (exact) return exact;

  const prefixed = blueprint.validators.filter((validator) =>
    validator.title.startsWith(`${title}.`),
  );
  const first = prefixed[0];
  if (first === undefined) {
    throw new AttestError('INVALID_DOCUMENT', 'Blueprint has no validator with that title', {
      title,
      available: blueprint.validators.map((validator) => validator.title),
    });
  }
  return first;
}

/** Maps the blueprint's compiler declaration onto the CIP-171 registry. */
export function compilerRef(blueprint: Blueprint): CompilerRef {
  const declared = blueprint.preamble.compiler;
  if (declared === undefined) {
    throw new AttestError('INVALID_DOCUMENT', 'Blueprint does not declare the compiler used');
  }
  const name = COMPILER_ALIASES[declared.name.toLowerCase()];
  if (name === undefined) {
    throw new AttestError('INVALID_DOCUMENT', 'Blueprint names a compiler outside the registry', {
      compiler: declared.name,
      registry: COMPILERS,
    });
  }
  return { name, version: declared.version };
}

/** Digest of the blueprint file exactly as written, so it can be re-fetched and compared. */
export function blueprintDigest(raw: string, algorithm?: DigestAlgorithm): string {
  return qb64Digest(raw, algorithm);
}
