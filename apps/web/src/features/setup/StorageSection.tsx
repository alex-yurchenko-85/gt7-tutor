import { useState } from 'react';
import { api } from '../../api/client.ts';
import { errorText, useResource } from '../../app/resource.ts';

export function megabytes(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

export function StorageSection() {
  const storage = useResource(() => api.storage(), []);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const cleanup = async () => {
    setConfirming(false);
    try {
      const done = await api.cleanup();
      setResult(`Cleaned ${done.captures} captures: ${megabytes(done.bytesBefore)} before, ${megabytes(done.bytesAfter)} after.`);
      storage.reload();
    } catch (error) {
      setResult(errorText(error));
    }
  };

  return (
    <section className="panel" aria-labelledby="storage-title">
      <h2 id="storage-title">Disk use</h2>
      {storage.data ? (
        <>
          <div className="kv">
            <span>Raw captures, all profiles</span>
            <b>{megabytes(storage.data.rawBytes)}</b>
          </div>
          <div className="kv">
            <span>Your captures</span>
            <b>
              {megabytes(storage.data.profileRawBytes)} in {storage.data.profileCaptures} {storage.data.profileCaptures === 1 ? 'capture' : 'captures'}
            </b>
          </div>
        </>
      ) : storage.error ? (
        <p className="error">{errorText(storage.error)}</p>
      ) : (
        <p className="sub">Reading disk use…</p>
      )}
      <p className="sub" style={{ marginTop: 10 }}>
        Cleaning keeps the parts of your captures that references and attempts use, and removes the rest. A capture without a reference or an
        attempt becomes empty. This cannot be undone.
      </p>
      {confirming ? (
        <div className="btn-row" style={{ marginTop: 10 }}>
          <button className="btn inline" type="button" onClick={cleanup}>
            Remove unused capture data
          </button>
          <button className="btn inline ghost" type="button" onClick={() => setConfirming(false)}>
            Keep everything
          </button>
        </div>
      ) : (
        <button className="btn inline ghost" type="button" style={{ marginTop: 10 }} onClick={() => setConfirming(true)}>
          Clean up captures
        </button>
      )}
      {result ? (
        <p className="notice" role="status">
          {result}
        </p>
      ) : null}
    </section>
  );
}
