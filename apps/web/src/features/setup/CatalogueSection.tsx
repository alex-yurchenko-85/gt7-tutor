import { useState } from 'react';
import type { CatalogueCheckResponse, CatalogueEntry } from '@gt7/contracts';
import { api } from '../../api/client.ts';
import { errorText, useResource } from '../../app/resource.ts';

const SHOWN_PER_GROUP = 12;

function entryLabel(entry: CatalogueEntry): string {
  return `${entry.code ? `${entry.code} ` : ''}${entry.name} (${entry.family})`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

function DiffGroup({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <h3>
        {title}: {items.length}
      </h3>
      <ul className="list">
        {items.slice(0, SHOWN_PER_GROUP).map(item => (
          <li key={item}>{item}</li>
        ))}
        {items.length > SHOWN_PER_GROUP ? <li className="sub">and {items.length - SHOWN_PER_GROUP} more</li> : null}
      </ul>
    </div>
  );
}

function Difference({ check, onApply, applying }: { check: CatalogueCheckResponse; onApply(): void; applying: boolean }) {
  const { diff } = check;
  if (diff.rejected) {
    return (
      <div className="notice bad" role="alert">
        <b>The update was rejected.</b> {diff.rejected} The catalogue did not change.
      </div>
    );
  }
  const total = diff.added.length + diff.changed.length + diff.removed.length;
  if (total === 0) {
    return (
      <p className="notice" role="status">
        The sources match the catalogue. There is nothing to update.
      </p>
    );
  }
  return (
    <div className="catalogue-diff" role="region" aria-label="Catalogue differences">
      <p className="sub">Review the differences. Nothing changes until you apply the update.</p>
      <DiffGroup title="Added" items={diff.added.map(entryLabel)} />
      <DiffGroup title="Changed" items={diff.changed.map(change => `${change.id}: ${change.fields.join(', ')}`)} />
      <DiffGroup title="Removed" items={diff.removed.map(entryLabel)} />
      <p className="sub">An entry that has your exercises is kept, and targets that you edited do not change.</p>
      <button className="btn" type="button" onClick={onApply} disabled={applying}>
        Apply update
      </button>
    </div>
  );
}

export function CatalogueSection() {
  const info = useResource(() => api.catalogueInfo(), []);
  const [check, setCheck] = useState<CatalogueCheckResponse | null>(null);
  const [busy, setBusy] = useState<'checking' | 'applying' | 'restoring' | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const run = async (kind: 'checking' | 'applying' | 'restoring', action: () => Promise<void>) => {
    setBusy(kind);
    setProblem(null);
    setDone(null);
    try {
      await action();
    } catch (error) {
      setProblem(errorText(error));
    } finally {
      setBusy(null);
    }
  };

  const checkUpdates = () =>
    run('checking', async () => {
      setCheck(null);
      setCheck(await api.checkCatalogue());
    });

  const apply = () =>
    run('applying', async () => {
      if (!check) return;
      await api.applyCatalogue(check.token);
      setCheck(null);
      setDone('The catalogue is updated.');
      info.reload();
    });

  const restore = () =>
    run('restoring', async () => {
      await api.restoreCatalogue();
      setCheck(null);
      setDone('The previous catalogue is active again.');
      info.reload();
    });

  const data = info.data;
  return (
    <section className="panel" aria-labelledby="catalogue-title">
      <h2 id="catalogue-title">Catalogue</h2>
      {data ? (
        <>
          <div className="kv">
            <span>Retrieved</span>
            <b>{formatDate(data.retrieved)}</b>
          </div>
          {Object.entries(data.counts.entries).map(([family, count]) => (
            <div className="kv" key={family}>
              <span>{family}</span>
              <b>{count}</b>
            </div>
          ))}
          <div className="kv">
            <span>Circuit layouts</span>
            <b>{data.counts.circuits}</b>
          </div>
          <div className="kv">
            <span>Cars</span>
            <b>{data.counts.cars}</b>
          </div>
          <p className="sub" style={{ marginTop: 10 }}>
            Sources:{' '}
            {data.sources.map((source, index) => (
              <span key={source.url}>
                {index > 0 ? '; ' : ''}
                {source.name} ({source.licence})
              </span>
            ))}
            . A catalogue entry does not mean that GT7 Tutor supports the exercise.
          </p>
        </>
      ) : info.error ? (
        <p className="error">{errorText(info.error)}</p>
      ) : (
        <p className="sub">Reading the catalogue…</p>
      )}
      <p className="sub" style={{ marginTop: 10 }}>
        Check for updates reads the two public sources over the internet. It sends no data about you or your driving.
      </p>
      <div className="btn-row" style={{ marginTop: 10 }}>
        <button className="btn inline ghost" type="button" onClick={checkUpdates} disabled={busy !== null}>
          {busy === 'checking' ? 'Checking…' : 'Check for updates'}
        </button>
        {data?.hasPrevious ? (
          <button className="btn inline ghost" type="button" onClick={restore} disabled={busy !== null}>
            Restore previous
          </button>
        ) : null}
      </div>
      {problem ? (
        <p className="notice bad" role="alert">
          {problem} The catalogue did not change.
        </p>
      ) : null}
      {done ? (
        <p className="notice" role="status">
          {done}
        </p>
      ) : null}
      {check ? <Difference check={check} onApply={apply} applying={busy === 'applying'} /> : null}
    </section>
  );
}
