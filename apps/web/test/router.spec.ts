import { describe, expect, it } from 'vitest';
import { parseRoute, paths } from '../src/app/router.tsx';

describe('router', () => {
  it('parse_add_before_exercise_id', () => {
    expect(parseRoute('/exercises/add')).toEqual({ name: 'add-exercise' });
    expect(paths.addExercise()).toBe('/exercises/add');
  });

  it('parse_exercise_page', () => {
    expect(parseRoute('/exercises/e0000000-0000-4000-8000-000000000001')).toEqual({ name: 'exercise', exerciseId: 'e0000000-0000-4000-8000-000000000001' });
    expect(parseRoute('/exercises/e0000000-0000-4000-8000-000000000001/')).toEqual({ name: 'exercise', exerciseId: 'e0000000-0000-4000-8000-000000000001' });
    expect(parseRoute('/exercises/e0000000-0000-4000-8000-000000000001/attempts')).toEqual({ name: 'attempts', exerciseId: 'e0000000-0000-4000-8000-000000000001' });
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

  it('drive_path', () => {
    expect(paths.drive()).toBe('/drive');
  });
});
