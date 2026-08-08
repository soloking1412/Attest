import { AttestError } from '@attest/core';

export interface Reporter {
  readonly json: boolean;
  line(text: string): void;
  detail(label: string, value: string): void;
  result(value: unknown): void;
  warn(text: string): void;
}

const LABEL_WIDTH = 14;

export function createReporter(
  json: boolean,
  stream: NodeJS.WritableStream = process.stdout,
): Reporter {
  const write = (text: string) => {
    stream.write(`${text}\n`);
  };

  return {
    json,
    line(text) {
      if (!json) write(text);
    },
    detail(label, value) {
      if (!json) write(`  ${label.padEnd(Math.max(LABEL_WIDTH, label.length + 2))}${value}`);
    },
    result(value) {
      if (json) write(JSON.stringify(value, null, 2));
    },
    warn(text) {
      if (!json) process.stderr.write(`warning: ${text}\n`);
    },
  };
}

export function describeError(error: unknown): string {
  if (error instanceof AttestError) {
    const details = Object.entries(error.details)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => `${key}=${format(value)}`)
      .join(' ');
    return details.length > 0 ? `${error.message} (${details})` : error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

function format(value: unknown): string {
  if (Array.isArray(value)) return value.join(',');
  if (typeof value === 'object' && value !== null) return JSON.stringify(value);
  return String(value);
}
