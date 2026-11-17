import { useMemo, useState, type FormEvent } from 'react';
import type { CatalogueListEntry, ExerciseStatusName } from '@gt7/contracts';
import { api } from '../../api/client.ts';
import { rememberExercise } from '../../app/current-exercise.ts';
import { formatOfficialTime } from '../../app/format.ts';
import { errorText, useResource } from '../../app/resource.ts';
import { paths, useRouter } from '../../app/router.tsx';
import { useSession } from '../../app/session.tsx';
import './catalogue.css';

type Filters = { family: string; q: string; collection: string; track: string; support: '' | 'verified' | 'unverified' };

const NO_FILTERS: Filters = { family: 'All', q: '', collection: '', track: '', support: '' };

const STATUS_TEXT: Record<ExerciseStatusName, string> = {
  new: 'no reference',
  ready: 'reference ready',
  practising: 'practising',
  bronze: 'bronze',
  silver: 'silver',
  gold: 'gold'
};

function entryTitle(entry: CatalogueListEntry): string {
  return `${entry.code ? `${entry.code} ` : ''}${entry.name}`;
}

function matches(entry: CatalogueListEntry, filters: Filters): boolean {
  const q = filters.q.trim().toLowerCase();
  const text = [entry.code, entry.name, entry.track, entry.car, entry.collection, entry.family].filter(Boolean).join(' ').toLowerCase();
  return (
    (filters.family === 'All' || entry.family === filters.family) &&
    (!filters.collection || entry.collection === filters.collection) &&
    (!filters.track || entry.track === filters.track) &&
    (!filters.support || entry.support === filters.support) &&
    (!q || text.includes(q))
  );
}

function unique(values: (string | null)[]): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b));
}

function SupportTag({ entry }: { entry: CatalogueListEntry }) {
  return entry.support === 'verified' ? <span className="tag y">Checked on the console</span> : <span className="tag n">Not checked on the console</span>;
}

function Detail({ entry }: { entry: CatalogueListEntry }) {
  const { user } = useSession();
  const { navigate } = useRouter();
  const [problem, setProblem] = useState<string | null>(null);
  const open = (exerciseId: string) => {
    rememberExercise(user.id, exerciseId);
    navigate(paths.now());
  };
  const add = async () => {
    setProblem(null);
    try {
      open((await api.createExercise({ catalogueId: entry.id })).id);
    } catch (error) {
      setProblem(errorText(error));
    }
  };
  const row = (label: string, value: string | null) =>
    value ? (
      <div className="kv">
        <span>{label}</span>
        <b>{value}</b>
      </div>
    ) : null;
  return (
    <>
      <p className="sub">
        {entry.family}, {entry.collection}
      </p>
      <h2 className="detail-title">{entryTitle(entry)}</h2>
      <p className="detail-support">
        <SupportTag entry={entry} />
      </p>
      {row('Car', entry.car)}
      {row('Track', entry.track)}
      {row('Sections', entry.sections ? String(entry.sections) : null)}
      {row('Gold', entry.targets ? formatOfficialTime(entry.targets.goldMs) : null)}
      {row('Silver', entry.targets ? formatOfficialTime(entry.targets.silverMs) : null)}
      {row('Bronze', entry.targets ? formatOfficialTime(entry.targets.bronzeMs) : null)}
      {row('Your status', entry.status ? STATUS_TEXT[entry.status] : null)}
      {entry.exerciseId ? (
        <button className="btn" type="button" onClick={() => open(entry.exerciseId!)}>
          Open this exercise
        </button>
      ) : (
        <button className="btn" type="button" onClick={add}>
          Add this exercise
        </button>
      )}
      {problem ? (
        <p className="error" role="alert">
          {problem}
        </p>
      ) : null}
      <p className="sub" style={{ marginTop: 12 }}>
        {entry.support === 'verified'
          ? 'GT7 Tutor was checked with this exercise on a PS5.'
          : 'Nobody has checked GT7 Tutor with this exercise on a PS5. You can still record a reference and try it.'}{' '}
        Medal times are default targets from the source. Source: {entry.source}.
      </p>
    </>
  );
}

function OwnExercise() {
  const { user } = useSession();
  const { navigate } = useRouter();
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
      const created = await api.createExercise({ family: family.trim(), name: name.trim(), conditions: {} });
      rememberExercise(user.id, created.id);
      navigate(paths.now());
    } catch (error) {
      setProblem(errorText(error));
    }
  };
  return (
    <form className="panel own-exercise" onSubmit={create} aria-label="Your own exercise" noValidate>
      <h2>Your own exercise</h2>
      <p className="sub">For an exercise that the catalogue does not list, such as a Time Trial on one layout.</p>
      <div className="field">
        <label htmlFor="own-family">Activity</label>
        <input id="own-family" value={family} onChange={event => setFamily(event.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="own-name">Name</label>
        <input id="own-name" value={name} onChange={event => setName(event.target.value)} />
      </div>
      {problem ? (
        <p className="error" role="alert">
          {problem}
        </p>
      ) : null}
      <button className="btn ghost" type="submit">
        Create exercise
      </button>
    </form>
  );
}

export function CatalogueView() {
  const entries = useResource(() => api.catalogue(), []);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const all = useMemo(() => entries.data ?? [], [entries.data]);
  const families = useMemo(() => unique(all.map(entry => entry.family)), [all]);
  const pool = useMemo(() => all.filter(entry => filters.family === 'All' || entry.family === filters.family), [all, filters.family]);
  const rows = useMemo(() => all.filter(entry => matches(entry, filters)), [all, filters]);
  const selected = rows.find(entry => entry.id === selectedId) ?? rows[0] ?? null;
  const set = (change: Partial<Filters>) => setFilters(current => ({ ...current, ...change }));
  const familyCount = (family: string) => (family === 'All' ? all.length : all.filter(entry => entry.family === family).length);

  if (entries.error) return <p className="error">{errorText(entries.error)}</p>;
  return (
    <section aria-labelledby="catalogue-title">
      <h1 id="catalogue-title">Catalogue</h1>
      <p className="lede">
        {all.length} exercises from community sources. An entry in this list is not a promise of support: only entries marked Checked on the console
        were tested with a PS5.
      </p>
      <div className="filters" role="group" aria-label="Activity">
        {['All', ...families].map(family => (
          <button
            key={family}
            type="button"
            className="chip"
            aria-pressed={filters.family === family}
            onClick={() => set({ family, collection: '', track: '' })}
          >
            {family} <span className="count">{familyCount(family)}</span>
          </button>
        ))}
      </div>
      <div className="filters">
        <input
          type="search"
          className="input search"
          placeholder="Search by name, code, track or car"
          aria-label="Search the catalogue"
          value={filters.q}
          onChange={event => set({ q: event.target.value })}
        />
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
        <select
          className="input"
          aria-label="Support"
          value={filters.support}
          onChange={event => set({ support: event.target.value as Filters['support'] })}
        >
          <option value="">Any support state</option>
          <option value="verified">Checked on the console</option>
          <option value="unverified">Not checked</option>
        </select>
      </div>
      <div className="wide">
        <div>
          <p className="sub" aria-live="polite">
            {entries.loading && !entries.data ? 'Reading the catalogue…' : `${rows.length} shown`}
          </p>
          {!entries.data ? null : rows.length ? (
            <div className="catalogue-list table-wrap">
              <table aria-label="Exercises">
                <thead>
                  <tr>
                    <th>Exercise</th>
                    <th className="hide-narrow">Collection</th>
                    <th>Track</th>
                    <th>State</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(entry => (
                    <tr key={entry.id} data-entry={entry.id} className={entry.id === selected?.id ? 'selected' : undefined}>
                      <td>
                        <button type="button" className="row-button" aria-pressed={entry.id === selected?.id} onClick={() => setSelectedId(entry.id)}>
                          {entryTitle(entry)}
                        </button>
                        <span className="sub row-family">{entry.family}</span>
                      </td>
                      <td className="hide-narrow">{entry.collection}</td>
                      <td>{entry.track ?? 'not tagged'}</td>
                      <td>
                        {entry.status ? (
                          <span className="tag y">{STATUS_TEXT[entry.status]}</span>
                        ) : entry.support === 'verified' ? (
                          <span className="tag">checked</span>
                        ) : (
                          <span className="tag n">not added</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="panel empty">
              <p>Nothing matches these filters. Clear the search or select another collection.</p>
              <button className="btn inline ghost" type="button" onClick={() => setFilters(NO_FILTERS)}>
                Clear filters
              </button>
            </div>
          )}
        </div>
        <div className="detail-column">
          <section className="panel" aria-label="Selected exercise">
            {selected ? <Detail entry={selected} /> : <p className="sub">Select an exercise in the list.</p>}
          </section>
          <OwnExercise />
        </div>
      </div>
    </section>
  );
}
