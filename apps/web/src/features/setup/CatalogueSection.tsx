import { useState } from 'react';
import type { CatalogueCheckResponse, CatalogueEntry } from '@gt7/contracts';
import { api } from '../../api/client.ts';
import { IconButton } from '../../app/IconButton.tsx';
import { Icon } from '../../app/icons.tsx';
import { formatClock, formatDate } from '../../app/format.ts';
import { errorText, useResource } from '../../app/resource.ts';
import { orderedFamilies } from '../exercises/next-step.ts';
import { lastCatalogueCheck, rememberCatalogueCheck, type CatalogueCheck } from './catalogue-check.ts';
import { t } from '../../app/i18n.ts';

const SHOWN_PER_GROUP = 12;

function entryLabel(entry: CatalogueEntry): string {
  return `${entry.code ? `${entry.code} ` : ''}${entry.name} (${entry.family})`;
}

function checkResult(check: CatalogueCheckResponse): string {
  if (check.diff.rejected) return t('setup.catalogue.rejected');
  const total = check.diff.added.length + check.diff.changed.length + check.diff.removed.length;
  if (total === 0) return t('setup.catalogue.no-changes');
  return t('setup.catalogue.changes', { count: total });
}

function lastCheckText(check: CatalogueCheck | null): string {
  if (!check) return t('setup.catalogue.not-checked');
  return t('setup.catalogue.last-checked', { date: formatDate(check.at), time: formatClock(new Date(check.at)), result: check.result });
}

function DiffGroup({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <h3>{t('setup.catalogue.group', { title, count: items.length })}</h3>
      <ul className="list">
        {items.slice(0, SHOWN_PER_GROUP).map(item => (
          <li key={item}>{item}</li>
        ))}
        {items.length > SHOWN_PER_GROUP ? <li className="sub">{t('setup.catalogue.more', { count: items.length - SHOWN_PER_GROUP })}</li> : null}
      </ul>
    </div>
  );
}

function Difference({ check, onApply, applying }: { check: CatalogueCheckResponse; onApply(): void; applying: boolean }) {
  const { diff } = check;
  if (diff.rejected) {
    return (
      <div className="notice bad" role="alert">
        <b>{t('setup.catalogue.rejected')}</b> {t('errors.rejected', diff.rejected)} {t('setup.catalogue.did-not-change')}
      </div>
    );
  }
  const total = diff.added.length + diff.changed.length + diff.removed.length;
  if (total === 0) {
    return (
      <p className="notice" role="status">
        {t('setup.catalogue.match')}
      </p>
    );
  }
  return (
    <div className="catalogue-diff" role="region" aria-label={t('setup.catalogue.differences')}>
      <p className="sub">{t('setup.catalogue.review')}</p>
      <DiffGroup title={t('setup.catalogue.added')} items={diff.added.map(entryLabel)} />
      <DiffGroup title={t('setup.catalogue.changed')} items={diff.changed.map(change => `${change.id}: ${change.fields.join(', ')}`)} />
      <DiffGroup title={t('setup.catalogue.removed')} items={diff.removed.map(entryLabel)} />
      <p className="sub">{t('setup.catalogue.kept')}</p>
      <button className="btn" type="button" onClick={onApply} disabled={applying}>
        {t('setup.catalogue.apply')}
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
        remember(t('setup.catalogue.check-failed'));
        throw error;
      }
    });

  const apply = () =>
    run('applying', async () => {
      if (!check) return;
      await api.applyCatalogue(check.token);
      setCheck(null);
      setDone(t('setup.catalogue.updated'));
      info.reload();
    });

  const restore = () =>
    run('restoring', async () => {
      await api.restoreCatalogue();
      setCheck(null);
      setDone(t('setup.catalogue.restored'));
      info.reload();
    });

  const data = info.data;
  return (
    <section className="panel setup-section" id="setup-catalogue" aria-labelledby="catalogue-title">
      <h2 id="catalogue-title">{t('setup.catalogue.title')}</h2>
      <p className="sub">{t('setup.catalogue.text')}</p>
      {data ? (
        <dl className="catalogue-counts">
          {[
            ...orderedFamilies(Object.keys(data.counts.entries))
              .filter(family => family in data.counts.entries)
              .map(family => [family, data.counts.entries[family]!] as const),
            [t('setup.catalogue.circuits'), data.counts.circuits] as const,
            [t('setup.catalogue.cars'), data.counts.cars] as const
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
        <p className="sub">{t('setup.catalogue.reading')}</p>
      )}
      <div className="pref">
        <span className="pref-text">
          <span>{t('setup.catalogue.version')}</span>
          {data ? <span className="pref-value">{formatDate(data.retrieved)}</span> : null}
          <span className="sub">{t('setup.catalogue.version-text')}</span>
        </span>
        <div className="pref-control">
          <div className="field-pair">
            <p className="sub check-status" role="status">
              {busy === 'checking' ? t('setup.catalogue.checking') : lastCheckText(lastCheck)}
            </p>
            <IconButton icon="refresh" label={t('setup.catalogue.check')} onClick={() => void checkUpdates()} disabled={busy !== null} />
          </div>
        </div>
      </div>
      {problem ? (
        <p className="notice bad" role="alert">
          {t('setup.catalogue.problem', { problem })}
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
            <span>{t('setup.catalogue.previous')}</span>
            <span className="sub">
              {data.previousRetrieved
                ? t('setup.catalogue.previous-dated', { date: formatDate(data.previousRetrieved) })
                : t('setup.catalogue.previous-text')}
            </span>
          </span>
          <div className="pref-control">
            <button className="btn inline ghost control-end" type="button" onClick={restore} disabled={busy !== null}>
              <Icon name="undo" size={18} />
              {busy === 'restoring' ? t('setup.catalogue.restoring') : t('setup.catalogue.restore')}
            </button>
          </div>
        </div>
      ) : null}
      {data ? (
        <p className="sub catalogue-sources">
          {t('setup.catalogue.sources')}{' '}
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
