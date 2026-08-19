'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

interface Check {
  name: string;
  status: 'pass' | 'fail' | 'skipped';
  detail: string;
}

interface Report {
  verdict: string;
  issuer?: string;
  digest?: string;
  sequence?: string;
  scripts: string[];
  checks: Check[];
  attestation?: { t: string; a: Record<string, unknown> };
}

const MARK: Record<Check['status'], string> = { pass: '✓', fail: '✕', skipped: '–' };

function Verify() {
  const params = useSearchParams();
  const [tx, setTx] = useState(params.get('tx') ?? '');
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function run(hash: string) {
    if (!/^[0-9a-f]{64}$/i.test(hash)) {
      setError('A transaction hash is 64 hex characters');
      return;
    }
    setError('');
    setReport(null);
    setBusy(true);
    try {
      const response = await fetch(`/api/verify?tx=${hash.toLowerCase()}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Verification failed');
      setReport(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Verification failed');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    const initial = params.get('tx');
    if (initial) void run(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <h1>Verify an attestation</h1>
      <p className="lede">
        Checks are made against chain data and the issuer&apos;s key event log. Nothing here is
        taken on trust from this site.
      </p>

      <div className="field">
        <label htmlFor="tx">Transaction hash</label>
        <input id="tx" value={tx} onChange={(e) => setTx(e.target.value)} className="mono" />
      </div>
      <button disabled={busy} onClick={() => void run(tx)}>
        {busy ? 'Checking…' : 'Verify'}
      </button>

      {error && <p className="bad">{error}</p>}

      {report && (
        <>
          <h2>Verdict</h2>
          <div className="panel">
            <p className={report.verdict === 'verified' ? 'ok' : 'bad'}>
              <strong>{report.verdict}</strong>
            </p>
            <dl>
              {report.issuer && (
                <>
                  <dt>Issuer</dt>
                  <dd className="mono">{report.issuer}</dd>
                </>
              )}
              {report.digest && (
                <>
                  <dt>Document</dt>
                  <dd className="mono">{report.digest}</dd>
                </>
              )}
              {report.scripts.length > 0 && (
                <>
                  <dt>Scripts</dt>
                  <dd className="mono">{report.scripts.join(', ')}</dd>
                </>
              )}
            </dl>
          </div>

          <h2>Checks</h2>
          <div className="panel">
            {report.checks.map((check) => (
              <div className="check" key={check.name}>
                <span
                  className={
                    check.status === 'pass' ? 'ok' : check.status === 'fail' ? 'bad' : 'dim'
                  }
                >
                  {MARK[check.status]}
                </span>
                <span>
                  <strong>{check.name}</strong>
                  <br />
                  <span className="dim">{check.detail}</span>
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<p className="dim">Loading…</p>}>
      <Verify />
    </Suspense>
  );
}
