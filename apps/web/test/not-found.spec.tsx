import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { isUuid } from '../src/app/ids.ts';
import { EXERCISE_ID, exerciseApi, rememberExercise } from './fixtures.ts';
import { renderApp, setViewportWidth } from './support.tsx';

const DELETED_ATTEMPT = 'a0000000-0000-4000-8000-0000000000ff';

describe('not found', () => {
  it('is_uuid_accepts_only_uuids', () => {
    expect(isUuid('9b2f0c4e-3c1a-4d5e-8f6a-1b2c3d4e5f60')).toBe(true);
    expect(isUuid('9B2F0C4E-3C1A-4D5E-8F6A-1B2C3D4E5F60')).toBe(true);
    expect(isUuid('abc')).toBe(false);
    expect(isUuid('9b2f0c4e3c1a4d5e8f6a1b2c3d4e5f60')).toBe(false);
  });

  it('bad_exercise_id_shows_exercise_not_found_without_request', async () => {
    const api = exerciseApi().install();
    renderApp({ path: '/exercises/abc/attempts' });
    expect(await screen.findByRole('heading', { level: 1, name: 'This exercise is not here' })).toBeInTheDocument();
    expect(screen.getByText('EXERCISE NOT FOUND')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Exercises' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: 'Open Add exercise' })).toHaveAttribute('href', '/exercises/add');
    expect(screen.getByText('/exercises/abc/attempts')).toBeInTheDocument();
    expect(api.calls.some(call => call.path.includes('/abc'))).toBe(false);
    expect(screen.queryByText(/uuid/i)).toBeNull();
  });

  it('bad_exercise_id_on_every_exercise_view', async () => {
    setViewportWidth(390);
    for (const path of ['/exercises/abc', '/exercises/abc/cues', '/exercises/abc/references', '/exercises/abc/record']) {
      exerciseApi().install();
      const view = renderApp({ path });
      expect(await screen.findByRole('heading', { level: 1, name: 'This exercise is not here' }), path).toBeInTheDocument();
      view.unmount();
    }
  });

  it('missing_exercise_shows_exercise_not_found', async () => {
    const missing = 'e0000000-0000-4000-8000-0000000000ff';
    exerciseApi().on(`GET /api/exercises/${missing}`, { status: 404, body: { message: 'Exercise not found' } }).install();
    renderApp({ path: `/exercises/${missing}` });
    expect(await screen.findByRole('heading', { level: 1, name: 'This exercise is not here' })).toBeInTheDocument();
  });

  it('deleted_attempt_shows_attempt_not_found', async () => {
    rememberExercise();
    exerciseApi()
      .on(`GET /api/attempts/${DELETED_ATTEMPT}`, { status: 404, body: { message: 'Attempt not found' } })
      .on(`GET /api/attempts/${DELETED_ATTEMPT}/review`, { status: 404, body: { message: 'Attempt not found' } })
      .install();
    renderApp({ path: `/attempts/${DELETED_ATTEMPT}/review` });
    expect(await screen.findByRole('heading', { level: 1, name: 'This attempt is not here' })).toBeInTheDocument();
    expect(screen.getByText('ATTEMPT NOT FOUND')).toBeInTheDocument();
    expect(screen.getByText('It was deleted, it belongs to another profile, or the link is old.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'All attempts' })).toHaveAttribute('href', `/exercises/${EXERCISE_ID}/attempts`);
  });

  it('bad_attempt_id_shows_attempt_not_found_without_request', async () => {
    const api = exerciseApi().install();
    renderApp({ path: '/attempts/not-a-uuid/review' });
    expect(await screen.findByRole('heading', { level: 1, name: 'This attempt is not here' })).toBeInTheDocument();
    expect(api.calls.some(call => call.path.includes('not-a-uuid'))).toBe(false);
    expect(screen.queryByRole('link', { name: 'All attempts' })).toBeNull();
  });

  it('unknown_path_shows_page_not_found', async () => {
    exerciseApi().install();
    renderApp({ path: '/no-such-page' });
    expect(await screen.findByRole('heading', { level: 1, name: 'This page does not exist' })).toBeInTheDocument();
    expect(screen.getByText('PAGE NOT FOUND')).toBeInTheDocument();
    const main = screen.getByRole('main');
    expect(within(main).getAllByRole('link').map(link => link.textContent)).toEqual(['Open Exercises']);
  });
});
