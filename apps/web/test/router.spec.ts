import { describe, expect, it } from 'vitest';
import { parseRoute, paths } from '../src/app/router.tsx';
import { EXERCISE_ID } from './fixtures.ts';

describe('router', () => {
  it('parse_add_before_exercise_id', () => {
    expect(parseRoute('/exercises/add')).toEqual({ name: 'add-exercise' });
    expect(paths.addExercise()).toBe('/exercises/add');
  });

  it('parse_exercise_page', () => {
    expect(parseRoute(`/exercises/${EXERCISE_ID}`)).toEqual({ name: 'cues', exerciseId: EXERCISE_ID });
    expect(parseRoute(`/exercises/${EXERCISE_ID}/`)).toEqual({ name: 'cues', exerciseId: EXERCISE_ID });
    expect(parseRoute(`/exercises/${EXERCISE_ID}/attempts`)).toEqual({ name: 'attempts', exerciseId: EXERCISE_ID });
    expect(parseRoute('/')).toEqual({ name: 'exercises' });
    expect(parseRoute('/setup/delete-history')).toEqual({ name: 'delete-history' });
    expect(parseRoute('/nowhere')).toEqual({ name: 'not-found' });
    expect(paths.exercise('ex 1')).toBe('/exercises/ex%201');
    expect(paths.exercises()).toBe('/');
    expect(paths.deleteHistory()).toBe('/setup/delete-history');
  });

  it('setup_section_path', () => {
    expect(paths.setup('voice')).toBe('/setup#voice');
    expect(paths.setup()).toBe('/setup');
  });

  it('drive_is_a_page_of_the_exercise', () => {
    expect(paths.drive('ex 1')).toBe('/exercises/ex%201/drive');
    expect(parseRoute(`/exercises/${EXERCISE_ID}/drive`)).toEqual({ name: 'drive', exerciseId: EXERCISE_ID });
    expect(parseRoute('/drive')).toEqual({ name: 'not-found' });
  });

  it('race_routes_match_record_before_a_race_id', () => {
    const id = 'a0000000-0000-4000-8000-000000000001';
    expect(parseRoute('/races')).toEqual({ name: 'races' });
    expect(parseRoute('/races/')).toEqual({ name: 'races' });
    expect(parseRoute('/races/record')).toEqual({ name: 'race-record' });
    expect(parseRoute(`/races/${id}`)).toEqual({ name: 'race', raceId: id, tab: 'laps' });
    expect(parseRoute(`/races/${id}/compare`)).toEqual({ name: 'race', raceId: id, tab: 'compare' });
    expect(parseRoute(`/races/${id}/off-track`)).toEqual({ name: 'race', raceId: id, tab: 'off-track' });
    expect(parseRoute(`/races/${id}/laps`)).toEqual({ name: 'not-found' });
    expect(parseRoute(`/races/${id}/speed`)).toEqual({ name: 'not-found' });
  });

  it('race_paths', () => {
    expect(paths.races()).toBe('/races');
    expect(paths.raceRecord()).toBe('/races/record');
    expect(paths.race('r 1')).toBe('/races/r%201');
    expect(paths.race('r1', 'laps')).toBe('/races/r1');
    expect(paths.race('r1', 'compare')).toBe('/races/r1/compare');
    expect(paths.race('r1', 'off-track')).toBe('/races/r1/off-track');
    expect(paths.raceCompare('r1', 5)).toBe('/races/r1/compare?lap=5');
    expect(paths.raceCompare('r1', 5, 2)).toBe('/races/r1/compare?lap=5&with=2');
  });
});
