import type { CatalogueListEntry, Exercise } from '@gt7/contracts';
import { CIRCUIT_EXPERIENCE } from '../exercise/use-exercise-where.ts';
import { orderedFamilies } from './next-step.ts';

export type PageFilters = { q: string; family: string; track: string };

const ALL = '';

export const OWN = 'Own';

export const NO_PAGE_FILTERS: PageFilters = { q: '', family: ALL, track: '' };

export type GroupRow = { entry: CatalogueListEntry | null; exercise: Exercise | null };

export type CatalogueGroup = {
  key: string;
  family: string;
  title: string;
  kind: 'tests' | 'sectors' | 'exercises';
  total: number;
  atTarget: number;
  inProgress: number;
  rows: GroupRow[];
};

export function isMine(exercise: Exercise): boolean {
  return exercise.catalogueId === null || exercise.referenceCount > 0;
}

export function isInProgress(exercise: Exercise): boolean {
  return isMine(exercise) && exercise.status !== 'target-reached';
}

export function isSearching(filters: PageFilters): boolean {
  return filters.q.trim() !== '' || filters.track !== '';
}

export function isFiltered(filters: PageFilters): boolean {
  return isSearching(filters) || filters.family !== ALL;
}

export function matchesSearch(text: string[], q: string): boolean {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const haystack = text.filter(Boolean).join(' ').toLowerCase();
  return words.every(word => haystack.includes(word));
}

type Searchable = { code: string | null; name: string; track?: string | null; car?: string | null; collection: string | null; family: string };

function searchText(item: Searchable): string[] {
  return [item.code, item.name, item.track, item.car, item.collection, item.family].filter((part): part is string => Boolean(part));
}

function entryMatches(entry: CatalogueListEntry, filters: PageFilters): boolean {
  return (
    (filters.family === ALL || entry.family === filters.family) &&
    (!filters.track || entry.track === filters.track) &&
    matchesSearch(searchText(entry), filters.q)
  );
}

function matchesWithoutTrack(exercise: Exercise, family: string, filters: PageFilters): boolean {
  return (filters.family === ALL || filters.family === family) && !filters.track && matchesSearch(searchText(exercise), filters.q);
}

function ownMatches(exercise: Exercise, filters: PageFilters): boolean {
  return matchesWithoutTrack(exercise, OWN, filters);
}

function exerciseMatches(exercise: Exercise, entry: CatalogueListEntry | undefined, filters: PageFilters): boolean {
  if (exercise.catalogueId === null) return ownMatches(exercise, filters);
  if (entry) return entryMatches(entry, filters);
  return matchesWithoutTrack(exercise, exercise.family, filters);
}

function byCreation(a: Exercise, b: Exercise): number {
  return a.createdAt.localeCompare(b.createdAt);
}

export function pageExercises(exercises: Exercise[], filters: PageFilters, catalogue: CatalogueListEntry[]): Exercise[] {
  const position = new Map(catalogue.map((entry, index) => [entry.id, index]));
  const entryOf = new Map(catalogue.map(entry => [entry.id, entry]));
  const shown = exercises.filter(exercise => exerciseMatches(exercise, exercise.catalogueId === null ? undefined : entryOf.get(exercise.catalogueId), filters));
  const catalogued = shown
    .filter(exercise => exercise.catalogueId !== null)
    .sort((a, b) => (position.get(a.catalogueId!) ?? Infinity) - (position.get(b.catalogueId!) ?? Infinity) || byCreation(a, b));
  const own = shown.filter(exercise => exercise.catalogueId === null).sort(byCreation);
  return [...catalogued, ...own];
}

function groupTitle(entry: CatalogueListEntry): string {
  if (entry.family === CIRCUIT_EXPERIENCE) return entry.track ?? entry.collection ?? entry.family;
  return entry.collection ?? entry.family;
}

function groupKind(family: string): CatalogueGroup['kind'] {
  if (family === 'Licence') return 'tests';
  if (family === CIRCUIT_EXPERIENCE) return 'sectors';
  return 'exercises';
}

function summarise(key: string, family: string, title: string, rows: GroupRow[]): CatalogueGroup {
  const own = rows.filter(row => row.exercise !== null && isMine(row.exercise));
  return {
    key,
    family,
    title,
    kind: groupKind(family),
    total: rows.length,
    atTarget: own.filter(row => row.exercise!.status === 'target-reached').length,
    inProgress: own.filter(row => row.exercise!.status !== 'target-reached').length,
    rows
  };
}

export function catalogueGroups(entries: CatalogueListEntry[], exercises: Exercise[], filters: PageFilters): CatalogueGroup[] {
  const byCatalogue = new Map(exercises.filter(exercise => exercise.catalogueId !== null).map(exercise => [exercise.catalogueId!, exercise]));
  const byId = new Map(exercises.map(exercise => [exercise.id, exercise]));
  const grouped = new Map<string, { family: string; title: string; rows: GroupRow[] }>();
  for (const entry of entries) {
    if (!entryMatches(entry, filters)) continue;
    const title = groupTitle(entry);
    const key = `${entry.family}/${title}`;
    const group = grouped.get(key) ?? { family: entry.family, title, rows: [] };
    const exercise = byCatalogue.get(entry.id) ?? (entry.exerciseId ? (byId.get(entry.exerciseId) ?? null) : null);
    group.rows.push({ entry, exercise });
    grouped.set(key, group);
  }
  const families = orderedFamilies([...grouped.values()].map(group => group.family));
  const catalogued = families.flatMap(family =>
    [...grouped.entries()].filter(([, group]) => group.family === family).map(([key, group]) => summarise(key, family, group.title, group.rows))
  );
  const ownRows: GroupRow[] = exercises
    .filter(exercise => exercise.catalogueId === null && ownMatches(exercise, filters))
    .sort(byCreation)
    .map(exercise => ({ entry: null, exercise }));
  const ownAllowed = filters.family === ALL || filters.family === OWN;
  const ownShown = ownAllowed && (ownRows.length > 0 || !isSearching(filters));
  return ownShown ? [...catalogued, summarise(`${OWN}/${OWN}`, OWN, OWN, ownRows)] : catalogued;
}

export function pageTracks(entries: CatalogueListEntry[]): string[] {
  return [...new Set(entries.map(entry => entry.track).filter((track): track is string => Boolean(track)))].sort((a, b) => a.localeCompare(b));
}
