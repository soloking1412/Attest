/**
 * CIP-30 browser wallet access.
 *
 * Attestations are signed and paid for by the person publishing them. The
 * application never holds a key: it prepares a transaction and hands it to the
 * wallet, which signs and submits under the user's own stake key.
 */
export interface Cip30Api {
  getUsedAddresses(): Promise<string[]>;
  getChangeAddress(): Promise<string>;
}

export interface WalletChoice {
  readonly key: string;
  readonly name: string;
  readonly icon: string;
}

interface Cip30Entry {
  name: string;
  icon: string;
  apiVersion: string;
  enable(): Promise<Cip30Api>;
  isEnabled(): Promise<boolean>;
}

function injected(): Record<string, Cip30Entry> {
  if (typeof window === 'undefined') return {};
  return (window as unknown as { cardano?: Record<string, Cip30Entry> }).cardano ?? {};
}

/** Wallets the browser is currently exposing, in a stable order. */
export function availableWallets(): WalletChoice[] {
  return Object.entries(injected())
    .filter(([, entry]) => typeof entry?.enable === 'function')
    .map(([key, entry]) => ({ key, name: entry.name ?? key, icon: entry.icon ?? '' }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function connect(key: string): Promise<Cip30Api> {
  const entry = injected()[key];
  if (entry === undefined) {
    throw new Error(`${key} is not available in this browser`);
  }
  return entry.enable();
}
