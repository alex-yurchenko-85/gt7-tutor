import { describe, expect, it } from 'vitest';
import { exerciseTitle, whereText } from '../src/features/exercise/use-exercise-where.ts';

describe('exercise title', () => {
  it('licence_shows_its_code_as_the_title_and_its_name_as_the_detail', () => {
    expect(exerciseTitle({ catalogueId: 'licence-b-5', family: 'Licence', name: 'Cornering Basics 3', collection: 'National B', code: 'B-5' })).toEqual({ title: 'National B, B-5', detail: 'Cornering Basics 3' });
  });

  it('brand_central_shows_its_code_as_the_title', () => {
    expect(exerciseTitle({ catalogueId: 'brand-yangwang-racing-lines', family: 'Brand Central', name: 'Yangwang U9 Track Edition', collection: 'Yangwang', code: 'EXP-1' })).toEqual({ title: 'Yangwang, EXP-1', detail: 'Yangwang U9 Track Edition' });
  });

  it('circuit_experience_keeps_its_name_and_has_no_detail', () => {
    expect(exerciseTitle({ catalogueId: 'ce-tsukuba-s1', family: 'Circuit Experience', name: 'Tsukuba Circuit · Sector 1', collection: 'Asia', code: 'Sector 1' })).toEqual({ title: 'Tsukuba Circuit · Sector 1', detail: null });
  });

  it('own_exercise_keeps_its_name_and_shows_own_exercises', () => {
    expect(exerciseTitle({ catalogueId: null, family: 'Time Trial', name: 'Tsukuba lap', collection: null, code: null })).toEqual({ title: 'Tsukuba lap', detail: 'Own exercises' });
  });

  it('exercise_without_its_catalogue_entry_keeps_its_name_and_has_no_detail', () => {
    expect(exerciseTitle({ catalogueId: 'licence-b-5', family: 'Licence', name: 'Cornering Basics 3', collection: null, code: null })).toEqual({ title: 'Cornering Basics 3', detail: null });
  });

  it('where_line_joins_the_family_the_detail_and_the_track', () => {
    expect(whereText({ family: 'Licence', detail: 'Cornering Basics 3', track: 'Tsukuba Circuit' })).toBe('Licence · Cornering Basics 3 · Tsukuba Circuit');
    expect(whereText({ family: 'Circuit Experience', detail: null, track: undefined })).toBe('Circuit Experience');
  });
});
