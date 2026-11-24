import { describe, expect, it } from 'vitest';
import type { CatalogueListEntry } from '@gt7/contracts';
import { catalogueEntry, exercise } from './fixtures.ts';
import { NO_PAGE_FILTERS, OWN, catalogueGroups, isFiltered, isInProgress, isMine, isSearching, matchesSearch, pageExercises, pageTracks } from '../src/features/exercises/exercise-page.ts';

const national = Array.from({ length: 10 }, (_, index) =>
  catalogueEntry({ id: `licence-b-${index + 1}`, family: 'Licence', collection: 'National B', code: `B-${index + 1}`, name: `Test ${index + 1}`, track: 'Autodrome Lago Maggiore' })
);

const tsukuba = [
  catalogueEntry({ id: 'ce-tsukuba-1', family: 'Circuit Experience', collection: 'Asia/Oceania', code: 'Sector 1', name: 'Sector 1', track: 'Tsukuba Circuit' }),
  catalogueEntry({ id: 'ce-tsukuba-2', family: 'Circuit Experience', collection: 'Asia/Oceania', code: 'Sector 2', name: 'Sector 2', track: 'Tsukuba Circuit' })
];

const brand = [catalogueEntry({ id: 'brand-hyundai-1', family: 'Brand Central', collection: 'Hyundai', code: 'EXP-1', name: 'Cornering', track: 'Suzuka Circuit', car: 'Hyundai IONIQ 5 N' })];

const ENTRIES: CatalogueListEntry[] = [...national, ...tsukuba, ...brand];

function mine(catalogueId: string | null, overrides: Parameters<typeof exercise>[0] = {}) {
  return exercise({ id: `ex-${catalogueId ?? 'own'}`, catalogueId, referenceCount: 1, ...overrides });
}

describe('exercise page model', () => {
  it('a_catalogue_exercise_without_a_reference_is_not_mine', () => {
    expect(isMine(mine('licence-b-9', { referenceCount: 0, activeReferenceId: null }))).toBe(false);
    expect(isMine(mine('licence-b-1'))).toBe(true);
  });

  it('an_own_exercise_is_mine_from_its_creation', () => {
    expect(isMine(mine(null, { referenceCount: 0, activeReferenceId: null }))).toBe(true);
  });

  it('in_progress_leaves_out_exercises_at_the_target', () => {
    const exercises = [mine('licence-b-2', { status: 'target-reached' }), mine('licence-b-1'), mine('licence-b-9', { referenceCount: 0 })];
    expect(pageExercises(exercises, NO_PAGE_FILTERS, ENTRIES).filter(isInProgress).map(item => item.catalogueId)).toEqual(['licence-b-1']);
  });

  it('in_progress_follows_the_catalogue_order_and_puts_own_exercises_last', () => {
    const exercises = [mine(null, { createdAt: '2026-11-10T10:00:00.000Z' }), mine('gone'), mine('ce-tsukuba-1'), mine('licence-b-3')];
    expect(pageExercises(exercises, NO_PAGE_FILTERS, ENTRIES).filter(isInProgress).map(item => item.catalogueId)).toEqual(['licence-b-3', 'ce-tsukuba-1', 'gone', null]);
  });

  it('groups_licence_by_collection_and_circuit_experience_by_track', () => {
    const groups = catalogueGroups([...national.slice(0, 2), ...tsukuba], [], NO_PAGE_FILTERS);
    expect(groups.map(group => [group.key, group.kind])).toEqual([
      ['Licence/National B', 'tests'],
      ['Circuit Experience/Tsukuba Circuit', 'sectors'],
      ['Own/Own', 'exercises']
    ]);
  });

  it('brand_central_groups_by_brand_and_keeps_the_family_order', () => {
    const groups = catalogueGroups([...brand, ...tsukuba, ...national], [], NO_PAGE_FILTERS);
    expect(groups.map(group => group.family)).toEqual(['Licence', 'Circuit Experience', 'Brand Central', 'Own']);
    expect(groups[2]).toMatchObject({ title: 'Hyundai', kind: 'exercises' });
  });

  it('counts_at_target_and_in_progress_per_group', () => {
    const exercises = [mine('licence-b-1', { status: 'target-reached' }), mine('licence-b-2')];
    const group = catalogueGroups(ENTRIES, exercises, NO_PAGE_FILTERS).find(item => item.key === 'Licence/National B')!;
    expect(group).toMatchObject({ total: 10, atTarget: 1, inProgress: 1 });
    expect(group.rows).toHaveLength(10);
    expect(group.rows[0]!.exercise?.catalogueId).toBe('licence-b-1');
    expect(group.rows[2]!.exercise).toBeNull();
  });

  it('a_row_of_an_entry_without_a_reference_has_no_exercise_for_the_counts_but_keeps_its_id', () => {
    const exercises = [mine('licence-b-9', { referenceCount: 0, activeReferenceId: null, status: 'new' })];
    const entries = national.map(entry => (entry.id === 'licence-b-9' ? { ...entry, exerciseId: 'ex-licence-b-9' } : entry));
    const group = catalogueGroups(entries, exercises, NO_PAGE_FILTERS).find(item => item.key === 'Licence/National B')!;
    expect(group.rows[8]!.exercise?.id).toBe('ex-licence-b-9');
    expect(group).toMatchObject({ inProgress: 0, atTarget: 0 });
  });

  it('own_exercises_fill_the_own_group_and_count_in_progress', () => {
    const own = mine(null, { name: 'My lap', family: 'Time Trial' });
    const group = catalogueGroups(ENTRIES, [own], NO_PAGE_FILTERS).at(-1)!;
    expect(group).toMatchObject({ key: 'Own/Own', total: 1, inProgress: 1, atTarget: 0 });
    expect(group.rows[0]).toEqual({ entry: null, exercise: own });
  });

  it('search_keeps_only_matching_rows_and_drops_empty_groups', () => {
    const groups = catalogueGroups(ENTRIES, [], { ...NO_PAGE_FILTERS, q: 'tsukuba' });
    expect(groups.map(group => group.key)).toEqual(['Circuit Experience/Tsukuba Circuit']);
    expect(groups[0]!.rows).toHaveLength(2);
  });

  it('the_family_filter_own_keeps_only_the_own_group', () => {
    const groups = catalogueGroups(ENTRIES, [], { ...NO_PAGE_FILTERS, family: OWN });
    expect(groups.map(group => group.key)).toEqual(['Own/Own']);
  });

  it('the_track_filter_applies_to_in_progress_and_groups', () => {
    const exercises = [mine('licence-b-1'), mine('ce-tsukuba-1')];
    const filters = { ...NO_PAGE_FILTERS, track: 'Tsukuba Circuit' };
    expect(pageExercises(exercises, filters, ENTRIES).filter(isInProgress).map(item => item.catalogueId)).toEqual(['ce-tsukuba-1']);
    expect(catalogueGroups(ENTRIES, exercises, filters).map(group => group.key)).toEqual(['Circuit Experience/Tsukuba Circuit']);
  });

  it('a_search_or_a_track_is_a_search_and_the_family_is_a_filter', () => {
    expect(isSearching(NO_PAGE_FILTERS)).toBe(false);
    expect(isSearching({ ...NO_PAGE_FILTERS, q: '  ' })).toBe(false);
    expect(isSearching({ ...NO_PAGE_FILTERS, q: 'b-3' })).toBe(true);
    expect(isSearching({ ...NO_PAGE_FILTERS, track: 'Tsukuba Circuit' })).toBe(true);
    expect(isSearching({ ...NO_PAGE_FILTERS, family: 'Licence' })).toBe(false);
    expect(isFiltered({ ...NO_PAGE_FILTERS, family: 'Licence' })).toBe(true);
    expect(isFiltered({ ...NO_PAGE_FILTERS, q: 'b-3' })).toBe(true);
    expect(isFiltered(NO_PAGE_FILTERS)).toBe(false);
  });

  it('search_matches_all_words_in_any_case', () => {
    expect(matchesSearch(['Tsukuba Circuit', 'Sector 1'], 'sector TSUKUBA')).toBe(true);
    expect(matchesSearch(['Tsukuba Circuit'], 'suzuka')).toBe(false);
    expect(matchesSearch(['anything'], '  ')).toBe(true);
  });

  it('tracks_are_listed_once_and_sorted', () => {
    expect(pageTracks(ENTRIES)).toEqual(['Autodrome Lago Maggiore', 'Suzuka Circuit', 'Tsukuba Circuit']);
  });
});
