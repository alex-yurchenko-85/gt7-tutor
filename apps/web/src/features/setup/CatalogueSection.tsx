import { useState } from 'react';
import type { CatalogueCheckResponse, CatalogueEntry } from '@gt7/contracts';
import { api } from '../../api/client.ts';
import { IconButton } from '../../app/IconButton.tsx';
import { Icon } from '../../app/icons.tsx';
import { formatClock, formatDate } from '../../app/format.ts';
import { counted } from '../../app/plural.ts';
import { errorText, useResource } from '../../app/resource.ts';
import { orderedFamilies } from '../exercises/next-step.ts';
import { lastCatalogueCheck, rememberCatalogueCheck, type CatalogueCheck } from './catalogue-check.ts';

const SHOWN_PER_GROUP = 12;

function entryLabel(entry: CatalogueEntry): string {
  return `${entry.code ? `${entry.code} ` : ''}${entry.name} (${entry.family})`;
}

function checkResult(check: CatalogueCheckResponse): string {
  if (check.diff.rejected) return 'The update was rejected.';
  const total = check.diff.added.length + check.diff.changed.length + check.diff.removed.length;
  if (total === 0) return 'No changes.';
  return `${counted(total, 'change')}, not applied.`;
}

function lastCheckText(check: CatalogueCheck | null): string {
  if (!check) return 'Not checked on this device yet.';
  return `Last checked ${formatDate(check.at)}, ${formatClock(new Date(check.at))}. ${check.result} On this device.`;
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
  const [lastCheck, setLastCheck] = useState<CatalogueCheck | null>(lastCatalogueCheck);

  const remember = (result: string) => {
    const next = { at: new Date().toISOString(), result };
    rememberCatalogueCheck(next);
    setLastCheck(next);
  };

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
      try {
        const found = await api.checkCatalogue();
        setCheck(found);
        remember(checkResult(found));
      } catch (error) {
        remember('The check failed.');
        throw error;
      }
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
    <section className="panel setup-section" id="setup-catalogue" aria-labelledby="catalogue-title">
      <h2 id="catalogue-title">Catalogue</h2>
      <p className="sub">The list of exercises you can select. A catalogue entry does not mean that GT7 Tutor supports the exercise.</p>
      {data ? (
        <dl className="catalogue-counts">
          {[
            ...orderedFamilies(Object.keys(data.counts.entries))
              .filter(family => family in data.counts.entries)
              .map(family => [family, data.counts.entries[family]!] as const),
            ['Circuit layouts', data.counts.circuits] as const,
            ['Cars', data.counts.cars] as const
          ].map(([label, count]) => (
            <div key={label}>
              <dd>{count}</dd>
              <dt>{label}</dt>
            </div>
          ))}
        </dl>
      ) : info.error ? (
        <p className="error">{errorText(info.error)}</p>
      ) : (
        <p className="sub">Reading the catalogue…</p>
      )}
      <div className="pref">
        <span className="pref-text">
          <span>Catalogue version</span>
          {data ? <span className="pref-value">{formatDate(data.retrieved)}</span> : null}
          <span className="sub">
            The date the public sources were read. The check reads them again over the internet and sends no data about you or your driving.
          </span>
        </span>
        <div className="pref-control">
          <div className="field-pair">
            <p className="sub check-status" role="status">
              {busy === 'checking' ? 'Checking…' : lastCheckText(lastCheck)}
            </p>
            <IconButton icon="refresh" label="Check for updates" onClick={() => void checkUpdates()} disabled={busy !== null} />
          </div>
        </div>
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
      {data?.hasPrevious ? (
        <div className="pref">
          <span className="pref-text">
            <span>Previous version</span>
            <span className="sub">
              {data.previousRetrieved
                ? `${formatDate(data.previousRetrieved)}. The last update changed the catalogue.`
                : 'The last update changed the catalogue.'}
            </span>
          </span>
          <div className="pref-control">
            <button className="btn inline ghost control-end" type="button" onClick={restore} disabled={busy !== null}>
              <Icon name="undo" size={18} />
              {busy === 'restoring' ? 'Restoring…' : 'Restore'}
            </button>
          </div>
        </div>
      ) : null}
      {data ? (
        <p className="sub catalogue-sources">
          Sources:{' '}
          {data.sources.map((source, index) => (
            <span key={source.url}>
              {index > 0 ? '; ' : ''}
              {source.name} ({source.licence})
            </span>
          ))}
          .
        </p>
      ) : null}
    </section>
  );
}
