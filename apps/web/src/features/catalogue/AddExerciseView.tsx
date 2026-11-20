import { useMemo, useState, type FormEvent } from 'react';
import type { CatalogueListEntry, CatalogueSource } from '@gt7/contracts';
import { api } from '../../api/client.ts';
import { announceExercisesChanged, rememberExercise } from '../../app/current-exercise.ts';
import { formatTime } from '../../app/format.ts';
import { IconButton } from '../../app/IconButton.tsx';
import { Icon } from '../../app/icons.tsx';
import { errorText, useResource } from '../../app/resource.ts';
import { Link, paths, useRouter } from '../../app/router.tsx';
import { useSession } from '../../app/session.tsx';
import { counted } from '../../app/plural.ts';
import { orderedFamilies } from '../exercises/next-step.ts';
import './catalogue.css';

type Filters = { family: string; q: string; collection: string; track: string };

const NO_FILTERS: Filters = { family: 'All', q: '', collection: '', track: '' };

const MINUTE_MS = 60000;

function matches(entry: CatalogueListEntry, filters: Filters): boolean {
  const q = filters.q.trim().toLowerCase();
  const text = [entry.code, entry.name, entry.track, entry.car, entry.collection, entry.family].filter(Boolean).join(' ').toLowerCase();
  return (
    (filters.family === 'All' || entry.family === filters.family) &&
    (!filters.collection || entry.collection === filters.collection) &&
    (!filters.track || entry.track === filters.track) &&
    (!q || text.includes(q))
  );
}

function unique(values: (string | null)[]): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b));
}

function targetTime(ms: number): string {
  return ms < MINUTE_MS ? (ms / 1000).toFixed(3) : formatTime(ms, 3);
}

function targetsText(entry: CatalogueListEntry): string {
  if (!entry.targets) return 'Not listed';
  return `Gold ${targetTime(entry.targets.goldMs)} · Silver ${targetTime(entry.targets.silverMs)} · Bronze ${targetTime(entry.targets.bronzeMs)}`;
}

function sourcesText(sources: CatalogueSource[]): string {
  return `Sources: ${sources.map(source => `${source.name} (${source.licence})`).join(' and ')}.`;
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
      <Link to={paths.exercise(entry.exerciseId)} className="add-action added" label={`Added · open ${entry.name}`}>
        Added · open
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
    <button type="button" className="add-action" aria-label={`Add ${entry.name}`} disabled={busy} onClick={() => void add()}>
      Add
    </button>
  );
}

function EntryRow({ entry, onProblem }: { entry: CatalogueListEntry; onProblem(problem: string | null): void }) {
  return (
    <tr data-entry={entry.id}>
      <td>
        <b className="entry-name">{entry.name}</b>
        <span className="sub entry-where">
          {entry.family} · {[entry.collection, entry.code].filter(Boolean).join(' ')}
        </span>
      </td>
      <td>
        {entry.track ?? 'Track not tagged'}
        {entry.car ? <span className="sub entry-car">{entry.car}</span> : null}
      </td>
      <td className="entry-targets">{targetsText(entry)}</td>
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
      setProblem('Enter an activity and a name.');
      return;
    }
    try {
      open((await api.createExercise({ family: family.trim(), name: name.trim() })).id);
    } catch (error) {
      setProblem(errorText(error));
    }
  };
  return (
    <form className="panel own-exercise" onSubmit={create} aria-label="Your own exercise" noValidate>
      <h2>Your own exercise</h2>
      <p className="sub">For an exercise that the catalogue does not list, such as a Time Trial on one layout.</p>
      <div className="field-pair">
        <div className="field">
          <label htmlFor="own-family">Activity</label>
          <input id="own-family" value={family} onChange={event => setFamily(event.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="own-name">Name</label>
          <input id="own-name" value={name} onChange={event => setName(event.target.value)} />
        </div>
        <IconButton icon="check" label="Create exercise" type="submit" />
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
  const pool = useMemo(() => all.filter(entry => filters.family === 'All' || entry.family === filters.family), [all, filters.family]);
  const rows = useMemo(() => all.filter(entry => matches(entry, filters)), [all, filters]);
  const set = (change: Partial<Filters>) => setFilters(current => ({ ...current, ...change }));

  if (entries.error) return <p className="error">{errorText(entries.error)}</p>;
  return (
    <section className="add-exercise" aria-labelledby="add-exercise-title">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link to={paths.exercises()}>Exercises</Link> / Add
      </nav>
      <h1 id="add-exercise-title">Add an exercise</h1>
      <p className="lede">{counted(all.length, 'exercise')} from the catalogue. Find the one that the game shows, then add it to your exercises.</p>
      <div className="add-filters">
        <label className="search-field">
          <Icon name="search" size={18} />
          <span className="visually-hidden">Search</span>
          <input
            type="search"
            value={filters.q}
            placeholder="Name, track, car or code, for example B-3"
            onChange={event => set({ q: event.target.value })}
          />
        </label>
        <div className="catalogue-selects">
          <select className="input" aria-label="Collection" value={filters.collection} onChange={event => set({ collection: event.target.value })}>
            <option value="">All collections</option>
            {unique(pool.map(entry => entry.collection)).map(value => (
              <option key={value}>{value}</option>
            ))}
          </select>
          <select className="input" aria-label="Track" value={filters.track} onChange={event => set({ track: event.target.value })}>
            <option value="">All tracks</option>
            {unique(pool.map(entry => entry.track)).map(value => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </div>
        <span className="sub catalogue-count" aria-live="polite">
          {entries.loading && !entries.data ? 'Reading the catalogue…' : `${rows.length} shown`}
        </span>
        <div className="filters" role="group" aria-label="Family">
          {['All', ...families].map(family => (
            <button
              key={family}
              type="button"
              className="chip"
              aria-pressed={filters.family === family}
              onClick={() => set({ family, collection: '', track: '' })}
            >
              {family}
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
          <table aria-label="Catalogue exercises">
            <thead>
              <tr>
                <th scope="col">Exercise</th>
                <th scope="col">Track and car</th>
                <th scope="col">Medal targets</th>
                <th scope="col">
                  <span className="visually-hidden">Action</span>
                </th>
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
          <p>No exercise matches.</p>
          <p className="sub">Check the spelling, or clear the filters.</p>
          <button className="btn inline ghost" type="button" onClick={() => setFilters(NO_FILTERS)}>
            Clear filters
          </button>
        </div>
      )}
      <OwnExercise />
      <p className="sub catalogue-sources">
        {info.data ? `${sourcesText(info.data.sources)} ` : ''}A catalogue entry does not mean that GT7 Tutor supports the exercise.
      </p>
    </section>
  );
}
