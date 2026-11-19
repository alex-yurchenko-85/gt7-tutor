import { waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { legacyRedirect, parseRoute, paths } from '../src/app/router.tsx';
import { ApiStub, renderApp, signedIn } from './support.tsx';

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
    expect(parseRoute('/nowhere')).toEqual({ name: 'not-found', kind: 'page' });
    expect(paths.exercise('ex 1')).toBe('/exercises/ex%201');
    expect(paths.exercises()).toBe('/');
    expect(paths.deleteHistory()).toBe('/setup/delete-history');
  });

  it('legacy_paths_redirect', () => {
    expect(legacyRedirect('/catalogue')).toBe('/exercises/add');
    expect(legacyRedirect('/catalogue/')).toBe('/exercises/add');
    expect(legacyRedirect('/progress')).toBe('/');
    expect(legacyRedirect('/exercises/x/cues')).toBeNull();
    expect(legacyRedirect('/')).toBeNull();
  });

  it('router_replaces_a_legacy_address_on_start', async () => {
    signedIn(new ApiStub()).on('GET /api/catalogue', []).install();
    renderApp({ path: '/catalogue?family=Licence' });
    await waitFor(() => expect(window.location.pathname).toBe('/exercises/add'));
    expect(window.location.search).toBe('?family=Licence');
  });

  it('setup_section_path', () => {
    expect(paths.setup('voice')).toBe('/setup#voice');
    expect(paths.setup()).toBe('/setup');
  });

  it('drive_path_with_mode', () => {
    expect(paths.drive()).toBe('/drive');
    expect(paths.drive('baseline')).toBe('/drive?mode=baseline');
  });
});
