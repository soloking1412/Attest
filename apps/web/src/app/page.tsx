'use client';

import { useEffect, useState } from 'react';

import { submitAttestation } from '@/lib/publish';
import { availableWallets, connect, type Cip30Api, type WalletChoice } from '@/lib/wallet';

interface AppConfig {
  network: string;
  lucidNetwork: 'Mainnet' | 'Preprod' | 'Preview';
  blockfrostUrl: string;
  blockfrostProjectId: string;
}

interface Prepared {
  said: string;
  issuer: string;
  sequence: string;
  script: { hash: string; plutusVersion: string; title?: string };
  metadata: Record<string, unknown>;
}

export default function Publish() {
  const [wallets, setWallets] = useState<WalletChoice[]>([]);
  const [api, setApi] = useState<Cip30Api | null>(null);
  const [address, setAddress] = useState('');
  const [config, setConfig] = useState<AppConfig | null>(null);

  const [blueprint, setBlueprint] = useState('');
  const [repository, setRepository] = useState('');
  const [commit, setCommit] = useState('');
  const [validator, setValidator] = useState('');

  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [txHash, setTxHash] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    setWallets(availableWallets());
    fetch('/api/config')
      .then((r) => r.json())
      .then((c) => (c.error ? setError(c.error) : setConfig(c)))
      .catch(() => setError('Could not read server configuration'));
  }, []);

  async function onConnect(key: string) {
    setError('');
    try {
      const enabled = await connect(key);
      const used = await enabled.getUsedAddresses();
      setApi(enabled);
      setAddress(used[0] ?? (await enabled.getChangeAddress()));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Wallet refused the connection');
    }
  }

  async function onPrepare() {
    setError('');
    setPrepared(null);
    setTxHash('');
    setBusy('Computing the script hash and committing to your key event log');
    try {
      const response = await fetch('/api/prepare', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ address, blueprint, repository, commit, validator }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Preparation failed');
      setPrepared(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Preparation failed');
    } finally {
      setBusy('');
    }
  }

  async function onSign() {
    if (!api || !prepared || !config) return;
    setError('');
    setBusy('Waiting for your wallet to sign');
    try {
      const hash = await submitAttestation({
        api,
        metadata: prepared.metadata as never,
        network: config.lucidNetwork,
        blockfrostUrl: config.blockfrostUrl,
        blockfrostProjectId: config.blockfrostProjectId,
      });
      setTxHash(hash);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The wallet rejected the transaction');
    } finally {
      setBusy('');
    }
  }

  const ready = address && blueprint && repository && commit;

  return (
    <>
      <h1>Publish an attestation</h1>
      <p className="lede">
        Bind a deployed script hash to the source it was built from. Your wallet signs and pays;
        nothing is custodial.
      </p>

      <h2>1 · Wallet</h2>
      {address ? (
        <div className="panel mono">{address}</div>
      ) : wallets.length === 0 ? (
        <div className="panel dim">
          No CIP-30 wallet detected. Install Lace, Eternl or Nami and switch it to{' '}
          {config?.network ?? 'preview'}.
        </div>
      ) : (
        <div className="wallets">
          {wallets.map((w) => (
            <button key={w.key} className="ghost" onClick={() => void onConnect(w.key)}>
              {w.name}
            </button>
          ))}
        </div>
      )}

      <h2>2 · What you are attesting</h2>
      <div className="field">
        <label htmlFor="bp">CIP-57 blueprint (contents of plutus.json)</label>
        <textarea
          id="bp"
          value={blueprint}
          onChange={(e) => setBlueprint(e.target.value)}
          placeholder='{"preamble": { ... }, "validators": [ ... ]}'
        />
      </div>
      <div className="row">
        <div className="field">
          <label htmlFor="repo">Repository</label>
          <input
            id="repo"
            value={repository}
            onChange={(e) => setRepository(e.target.value)}
            placeholder="https://github.com/org/repo"
          />
        </div>
        <div className="field">
          <label htmlFor="commit">Commit</label>
          <input
            id="commit"
            value={commit}
            onChange={(e) => setCommit(e.target.value)}
            placeholder="40 hex characters"
          />
        </div>
      </div>
      <div className="field">
        <label htmlFor="val">Validator title (only if the blueprint holds several)</label>
        <input id="val" value={validator} onChange={(e) => setValidator(e.target.value)} />
      </div>

      <button disabled={!ready || busy !== ''} onClick={() => void onPrepare()}>
        Prepare attestation
      </button>

      {busy && <p className="dim">{busy}…</p>}
      {error && <p className="bad">{error}</p>}

      {prepared && (
        <>
          <h2>3 · Review and sign</h2>
          <div className="panel">
            <dl>
              <dt>Script</dt>
              <dd className="mono">{prepared.script.hash}</dd>
              <dt>Plutus</dt>
              <dd>{prepared.script.plutusVersion}</dd>
              <dt>Issuer</dt>
              <dd className="mono">{prepared.issuer}</dd>
              <dt>Document</dt>
              <dd className="mono">{prepared.said}</dd>
              <dt>Key event</dt>
              <dd>sequence {prepared.sequence}</dd>
            </dl>
          </div>
          <p className="dim">
            The script hash above was recomputed from the bytecode, not read from the blueprint.
          </p>
          <button disabled={busy !== ''} onClick={() => void onSign()}>
            Sign and submit
          </button>
        </>
      )}

      {txHash && (
        <>
          <h2>Published</h2>
          <div className="panel">
            <p className="mono">{txHash}</p>
            <p>
              <a href={`/verify?tx=${txHash}`}>Verify it</a>
            </p>
          </div>
        </>
      )}
    </>
  );
}
