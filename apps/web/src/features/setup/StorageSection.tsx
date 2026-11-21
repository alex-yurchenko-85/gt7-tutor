import { useState } from 'react';
import { api } from '../../api/client.ts';
import { errorText, useResource } from '../../app/resource.ts';
import { Link, paths } from '../../app/router.tsx';
import { t } from '../../app/i18n.ts';

export function megabytes(bytes: number): string {
  return t('setup.storage.megabytes', { value: (bytes / 1_000_000).toFixed(1) });
}

export function StorageSection() {
  const storage = useResource(() => api.storage(), []);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const cleanup = async () => {
    setConfirming(false);
    try {
      const done = await api.cleanup();
      setResult(t('setup.storage.cleaned', { count: done.captures, before: megabytes(done.bytesBefore), after: megabytes(done.bytesAfter) }));
      storage.reload();
    } catch (error) {
      setResult(errorText(error));
    }
  };

  return (
    <section className="panel setup-section" id="setup-data" aria-labelledby="data-title">
      <h2 id="data-title">{t('setup.storage.title')}</h2>
      {storage.data ? (
        <>
          <div className="kv">
            <span>{t('setup.storage.yours')}</span>
            <b>{t('setup.storage.yours-size', { size: megabytes(storage.data.profileRawBytes), count: storage.data.profileCaptures })}</b>
          </div>
          <div className="kv">
            <span>{t('setup.storage.all')}</span>
            <b>{megabytes(storage.data.rawBytes)}</b>
          </div>
        </>
      ) : storage.error ? (
        <p className="error">{errorText(storage.error)}</p>
      ) : (
        <p className="sub">{t('setup.storage.reading')}</p>
      )}
      <div className="pref narrow-controls">
        <span className="pref-text">
          <span>{t('setup.storage.cleanup')}</span>
          <span className="sub">{t('setup.storage.cleanup-text')}</span>
        </span>
        <div className="pref-control">
          {confirming ? (
            <>
              <button className="btn" type="button" onClick={cleanup}>
                {t('setup.storage.cleanup')}
              </button>
              <button className="btn ghost" type="button" onClick={() => setConfirming(false)}>
                {t('setup.storage.keep')}
              </button>
            </>
          ) : (
            <button className="btn danger" type="button" onClick={() => setConfirming(true)}>
              {t('setup.storage.cleanup')}
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
          <span>{t('setup.storage.history')}</span>
          <span className="sub">{t('setup.storage.history-text')}</span>
        </span>
        <div className="pref-control">
          <Link to={paths.deleteHistory()} className="btn danger">
            {t('setup.storage.history')}
          </Link>
        </div>
      </div>
    </section>
  );
}
