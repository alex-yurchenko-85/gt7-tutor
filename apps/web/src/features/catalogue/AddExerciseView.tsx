import { useMemo, useState, type FormEvent } from 'react';
import type { CatalogueListEntry, CatalogueSource } from '@gt7/contracts';
import { api } from '../../api/client.ts';
import { announceExercisesChanged, rememberExercise } from '../../app/current-exercise.ts';
import { IconButton } from '../../app/IconButton.tsx';
import { Icon } from '../../app/icons.tsx';
import { errorText, useResource } from '../../app/resource.ts';
import { Link, paths, useRouter } from '../../app/router.tsx';
import { useSession } from '../../app/session.tsx';
import { CIRCUIT_EXPERIENCE, placeParts } from '../exercise/use-exercise-where.ts';
import { orderedFamilies } from '../exercises/next-step.ts';
import './catalogue.css';
import { listText, t } from '../../app/i18n.ts';

type Filters = { family: string; q: string; collection: string; track: string };

const ALL = '';

const NO_FILTERS: Filters = { family: ALL, q: '', collection: '', track: '' };

function matches(entry: CatalogueListEntry, filters: Filters): boolean {
  const q = filters.q.trim().toLowerCase();
  const text = [entry.code, entry.name, entry.track, entry.car, entry.collection, entry.family].filter(Boolean).join(' ').toLowerCase();
  return (
    (filters.family === ALL || entry.family === filters.family) &&
    (!filters.collection || entry.collection === filters.collection) &&
    (!filters.track || entry.track === filters.track) &&
    (!q || text.includes(q))
  );
}

function present(values: (string | null)[]): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function sorted(values: (string | null)[]): string[] {
  return present(values).sort((a, b) => a.localeCompare(b));
}

function entryHeading(entry: CatalogueListEntry): string {
  if (entry.family === CIRCUIT_EXPERIENCE) return entry.code ?? entry.name;
  return placeParts(entry.family, entry.collection, entry.code).join(', ');
}

function entryDetail(entry: CatalogueListEntry): string | null {
  return entry.family === CIRCUIT_EXPERIENCE ? null : entry.name;
}

function sourcesText(sources: CatalogueSource[]): string {
  return t('exercises.add.sources', { sources: listText(sources.map(source => t('exercises.add.source', { name: source.name, licence: source.licence })), 'conjunction') });
}

function useOpenExercise() {
  const { user } = useSession();
  const { navigate } = useRouter();
  return (exerciseId: string) => {
    rememberExercise(user.id, exerciseId);
    announceExercisesChanged();
    navigate(paths.exercise(exerciseId));
  };
}

function EntryAction({ entry, onProblem }: { entry: CatalogueListEntry; onProblem(problem: string | null): void }) {
  const open = useOpenExercise();
  const [busy, setBusy] = useState(false);
  if (entry.exerciseId) {
    return (
      <Link to={paths.exercise(entry.exerciseId)} className="add-action added">
        {t('exercises.add.added')}
      </Link>
    );
  }
  const add = async () => {
    onProblem(null);
    setBusy(true);
    try {
      open((await api.createExercise({ catalogueId: entry.id })).id);
    } catch (error) {
      onProblem(errorText(error));
      setBusy(false);
    }
  };
  return (
    <button type="button" className="add-action" disabled={busy} onClick={() => void add()}>
      {t('exercises.add.add')}
    </button>
  );
}

function EntryRow({ entry, onProblem }: { entry: CatalogueListEntry; onProblem(problem: string | null): void }) {
  return (
    <tr data-entry={entry.id}>
      <td>
        <b className="entry-name">{entryHeading(entry)}</b>
        {entryDetail(entry) ? <span className="sub entry-where">{entryDetail(entry)}</span> : null}
      </td>
      <td>
        {entry.track ?? t('exercises.add.no-track')}
        {entry.car ? <span className="sub entry-car">{entry.car}</span> : null}
      </td>
      <td className="entry-action">
        <EntryAction entry={entry} onProblem={onProblem} />
      </td>
    </tr>
  );
}

function OwnExercise() {
  const open = useOpenExercise();
  const [family, setFamily] = useState('Time Trial');
  const [name, setName] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim() || !family.trim()) {
      setProblem(t('exercises.add.own-empty'));
      return;
    }
    try {
      open((await api.createExercise({ family: family.trim(), name: name.trim() })).id);
    } catch (error) {
      setProblem(errorText(error));
    }
  };
  return (
    <form className="panel own-exercise" onSubmit={create} noValidate>
      <h2>{t('exercises.add.own-label')}</h2>
      <p className="sub">{t('exercises.add.own-text')}</p>
      <div className="field-pair">
        <div className="field">
          <label htmlFor="own-family">{t('exercises.add.activity')}</label>
          <input id="own-family" value={family} onChange={event => setFamily(event.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="own-name">{t('exercises.add.name')}</label>
          <input id="own-name" value={name} onChange={event => setName(event.target.value)} />
        </div>
        <IconButton icon="check" label={t('exercises.add.create')} type="submit" />
      </div>
      {problem ? (
        <p className="error" role="alert">
          {problem}
        </p>
      ) : null}
    </form>
  );
}

export function AddExerciseView() {
  const entries = useResource(() => api.catalogue(), []);
  const info = useResource(() => api.catalogueInfo(), []);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [problem, setProblem] = useState<string | null>(null);
  const all = useMemo(() => entries.data ?? [], [entries.data]);
  const families = useMemo(() => orderedFamilies(all.map(entry => entry.family)), [all]);
  const pool = useMemo(() => all.filter(entry => filters.family === ALL || entry.family === filters.family), [all, filters.family]);
  const rows = useMemo(() => all.filter(entry => matches(entry, filters)), [all, filters]);
  const set = (change: Partial<Filters>) => setFilters(current => ({ ...current, ...change }));

  if (entries.error) return <p className="error">{errorText(entries.error)}</p>;
  return (
    <section className="add-exercise">
      <nav className="breadcrumb">
        <Link to={paths.exercises()}>{t('exercises.breadcrumb.exercises')}</Link> / {t('exercises.add.breadcrumb')}
      </nav>
      <h1>{t('exercises.add.title')}</h1>
      <p className="lede">{t('exercises.add.lede', { count: all.length })}</p>
      <div className="add-filters">
        <label className="search-field">
          <Icon name="search" size={18} />
          <input
            type="search"
            value={filters.q}
            placeholder={t('exercises.add.search-hint')}
            onChange={event => set({ q: event.target.value })}
          />
        </label>
        <div className="catalogue-selects">
          <select className="input" value={filters.collection} onChange={event => set({ collection: event.target.value })}>
            <option value="">{t('exercises.add.all-collections')}</option>
            {present(pool.map(entry => entry.collection)).map(value => (
              <option key={value}>{value}</option>
            ))}
          </select>
          <select className="input" value={filters.track} onChange={event => set({ track: event.target.value })}>
            <option value="">{t('exercises.add.all-tracks')}</option>
            {sorted(pool.map(entry => entry.track)).map(value => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </div>
        <span className="sub catalogue-count">
          {entries.loading && !entries.data ? t('exercises.add.reading') : t('exercises.add.shown', { count: rows.length })}
        </span>
        <div className="filters">
          {[ALL, ...families].map(family => (
            <button
              key={family}
              type="button"
              className="chip"
              aria-pressed={filters.family === family}
              onClick={() => set({ family, collection: '', track: '' })}
            >
              {family === ALL ? t('exercises.add.all') : family}
            </button>
          ))}
        </div>
      </div>
      {problem ? (
        <p className="error" role="alert">
          {problem}
        </p>
      ) : null}
      {!entries.data ? null : rows.length ? (
        <div className="catalogue-list">
          <table>
            <thead>
              <tr>
                <th scope="col">{t('exercises.add.exercise')}</th>
                <th scope="col">{t('exercises.add.track-and-car')}</th>
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {rows.map(entry => (
                <EntryRow key={entry.id} entry={entry} onProblem={setProblem} />
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="panel empty">
          <p>{t('exercises.add.no-match')}</p>
          <p className="sub">{t('exercises.add.no-match-hint')}</p>
          <button className="btn inline ghost" type="button" onClick={() => setFilters(NO_FILTERS)}>
            {t('exercises.add.clear')}
          </button>
        </div>
      )}
      <OwnExercise />
      <p className="sub catalogue-sources">
        {info.data ? `${sourcesText(info.data.sources)} ` : ''}
        {t('exercises.add.no-support')}
      </p>
    </section>
  );
}
