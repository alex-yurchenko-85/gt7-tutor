import { useState } from 'react';
import { api } from '../../api/client.ts';
import { errorText, useResource } from '../../app/resource.ts';
import { Link, paths } from '../../app/router.tsx';

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
    <section className="panel setup-section" id="setup-data" aria-labelledby="data-title">
      <h2 id="data-title">Data</h2>
      {storage.data ? (
        <>
          <div className="kv">
            <span>Your captures</span>
            <b>
              {megabytes(storage.data.profileRawBytes)} in {storage.data.profileCaptures} {storage.data.profileCaptures === 1 ? 'capture' : 'captures'}
            </b>
          </div>
          <div className="kv">
            <span>Raw captures, all profiles</span>
            <b>{megabytes(storage.data.rawBytes)}</b>
          </div>
        </>
      ) : storage.error ? (
        <p className="error">{errorText(storage.error)}</p>
      ) : (
        <p className="sub">Reading disk use…</p>
      )}
      <div className="pref narrow-controls">
        <span className="pref-text">
          <span>Clean up captures</span>
          <span className="sub">Keeps the parts that references and attempts use and removes the rest. You cannot undo it.</span>
        </span>
        <div className="pref-control">
          {confirming ? (
            <>
              <button className="btn" type="button" onClick={cleanup}>
                Remove unused capture data
              </button>
              <button className="btn ghost" type="button" onClick={() => setConfirming(false)}>
                Keep everything
              </button>
            </>
          ) : (
            <button className="btn danger" type="button" onClick={() => setConfirming(true)}>
              Clean up captures…
            </button>
          )}
          {result ? (
            <p className="notice" role="status">
              {result}
            </p>
          ) : null}
        </div>
      </div>
      <div className="pref narrow-controls">
        <span className="pref-text">
          <span>Delete history</span>
          <span className="sub">Deletes attempts, or attempts and references, of one exercise or of all. The exercises stay.</span>
        </span>
        <div className="pref-control">
          <Link to={paths.deleteHistory()} className="btn danger">
            Delete history…
          </Link>
        </div>
      </div>
    </section>
  );
}
