import { AttestError } from '@attest/core';

export interface HttpOptions {
  readonly baseUrl: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 4;
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

export class HttpClient {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;

  constructor(options: HttpOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.headers = { accept: 'application/json', ...options.headers };
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  }

  async get<T>(path: string, query: Record<string, string | number | undefined> = {}): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    return this.request<T>(url, { method: 'GET' });
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>(new URL(`${this.baseUrl}${path}`), {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    });
  }

  /** Distinguishes a genuine 404 from a failure, for endpoints where absence is an answer. */
  async getOptional<T>(path: string): Promise<T | undefined> {
    try {
      return await this.get<T>(path);
    } catch (error) {
      if (error instanceof AttestError && error.details.status === 404) return undefined;
      throw error;
    }
  }

  private async request<T>(url: URL, init: RequestInit): Promise<T> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      if (attempt > 0) await delay(backoffMs(attempt));

      let response: Response;
      try {
        response = await fetch(url, {
          ...init,
          headers: { ...this.headers, ...(init.headers as Record<string, string> | undefined) },
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (cause) {
        lastError = new AttestError('PROVIDER_ERROR', 'Request to the chain provider failed', {
          url: url.pathname,
          cause: (cause as Error).message,
        });
        continue;
      }

      if (response.ok) {
        return (await response.json()) as T;
      }

      const detail = await readErrorBody(response);
      lastError = new AttestError('PROVIDER_ERROR', `Chain provider returned ${response.status}`, {
        url: url.pathname,
        status: response.status,
        detail,
      });

      if (!RETRYABLE_STATUS.has(response.status)) break;
    }

    throw lastError;
  }
}

function backoffMs(attempt: number): number {
  const base = Math.min(1000 * 2 ** (attempt - 1), 8000);
  return base + Math.floor(Math.random() * 250);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readErrorBody(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 500);
  } catch {
    return '';
  }
}
