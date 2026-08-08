import { AttestError } from '@attest/core';

export interface ParsedArgs {
  readonly positional: readonly string[];
  readonly flags: Readonly<Record<string, string | boolean>>;
}

/**
 * Parses `--name value`, `--name=value` and `--flag`, stopping option parsing
 * at `--`. Values are never split on commas: repeated options collect instead,
 * so a value containing a comma survives intact.
 */
export function parseArgs(argv: readonly string[]): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, string | boolean | string[]> = {};
  let literal = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] as string;

    if (literal || !token.startsWith('-')) {
      positional.push(token);
      continue;
    }
    if (token === '--') {
      literal = true;
      continue;
    }

    const body = token.replace(/^--?/, '');
    const equals = body.indexOf('=');

    let name: string;
    let value: string | boolean;
    if (equals >= 0) {
      name = body.slice(0, equals);
      value = body.slice(equals + 1);
    } else {
      name = body;
      const next = argv[index + 1];
      if (next !== undefined && !next.startsWith('-')) {
        value = next;
        index += 1;
      } else {
        value = true;
      }
    }

    const existing = flags[name];
    if (existing === undefined) {
      flags[name] = value;
    } else if (Array.isArray(existing)) {
      existing.push(String(value));
    } else {
      flags[name] = [String(existing), String(value)];
    }
  }

  return { positional, flags: flags as Record<string, string | boolean> };
}

export function flag(args: ParsedArgs, name: string): string | undefined {
  const value = args.flags[name];
  if (value === undefined || value === true) return undefined;
  return Array.isArray(value) ? (value as string[])[0] : String(value);
}

export function flags(args: ParsedArgs, name: string): string[] {
  const value = args.flags[name];
  if (value === undefined || value === true) return [];
  return Array.isArray(value) ? (value as string[]) : [String(value)];
}

export function boolFlag(args: ParsedArgs, name: string): boolean {
  return args.flags[name] === true || args.flags[name] === 'true';
}

export function requireFlag(args: ParsedArgs, name: string): string {
  const value = flag(args, name);
  if (value === undefined) {
    throw new AttestError('INVALID_DOCUMENT', `Missing required option --${name}`, {
      option: name,
    });
  }
  return value;
}

export function positional(args: ParsedArgs, index: number, name: string): string {
  const value = args.positional[index];
  if (value === undefined) {
    throw new AttestError('INVALID_DOCUMENT', `Missing required argument <${name}>`, { name });
  }
  return value;
}
