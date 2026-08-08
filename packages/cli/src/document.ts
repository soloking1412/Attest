import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { parseAttestation, serialize, type Attestation } from '@attest/core';

export const DEFAULT_DIRECTORY = 'attestations';

/** Attestation files are named by their identifier, so contents and name agree. */
export function documentPath(attestation: Attestation, directory = DEFAULT_DIRECTORY): string {
  return resolve(directory, `${attestation.d}.json`);
}

export async function writeAttestation(attestation: Attestation, path: string): Promise<string> {
  const target = resolve(path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${serialize(attestation)}\n`, 'utf8');
  return target;
}

export async function readAttestation(path: string): Promise<Attestation> {
  return parseAttestation((await readFile(resolve(path), 'utf8')).trim());
}
