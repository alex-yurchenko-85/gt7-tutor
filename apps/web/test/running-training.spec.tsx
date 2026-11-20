import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { EXERCISE_ID, exercise, exerciseApi, rememberExercise } from './fixtures.ts';
import { attemptSummary } from './review-fixtures.ts';
import { renderApp, sendLiveState, setViewportWidth } from './support.tsx';

const NAME = exercise().name;
const REVIEW_PATH = '/attempts/a0000000-0000-4000-8000-000000000001/review';

function trainingApi() {
  rememberExercise();
  return exerciseApi().on('GET /api/attempts/a0000000-0000-4000-8000-000000000001', attemptSummary());
}

describe('running training', () => {
  it('bar_shows_on_every_screen_but_drive', async () => {
    setViewportWidth(1440);
    trainingApi().install();
    const view = renderApp({ path: REVIEW_PATH });
    await sendLiveState(view, { mode: 'finished', exerciseId: EXERCISE_ID });
    const bar = await screen.findByRole('status', { name: 'Training' });
    await waitFor(() => expect(bar).toHaveTextContent(`The training is on: ${NAME}. Restart the exercise in GT7 to drive the next attempt.`));
    expect(within(bar).getByRole('link', { name: 'Open Drive' })).toHaveAttribute('href', '/drive');
    expect(within(bar).getByRole('button', { name: 'Stop training' })).toBeInTheDocument();
  });

  it('bar_on_a_phone_loads_the_name_and_keeps_the_short_text', async () => {
    setViewportWidth(390);
    const api = trainingApi().install();
    const view = renderApp({ path: '/exercises/e0000000-0000-4000-8000-000000000001/attempts' });
    await screen.findByRole('navigation', { name: 'Exercise' });
    expect(api.calls.filter(call => call.method === 'GET' && call.path === '/api/exercises')).toHaveLength(0);
    await sendLiveState(view, { mode: 'armed', exerciseId: EXERCISE_ID });
    const bar = await screen.findByRole('status', { name: 'Training' });
    await waitFor(() => expect(bar.querySelector('.running-bar-text')).toHaveTextContent(`The training is on: ${NAME}.`));
    expect(bar).not.toHaveTextContent('Restart the exercise');
  });

  it('bar_without_a_known_name_still_shows', async () => {
    setViewportWidth(1440);
    trainingApi().install();
    const view = renderApp({ path: '/' });
    await sendLiveState(view, { mode: 'armed', exerciseId: 'e0000000-0000-4000-8000-000000000099' });
    expect(await screen.findByRole('status', { name: 'Training' })).toHaveTextContent('The training is on. Restart the exercise in GT7 to drive the next attempt.');
  });

  it('bar_is_absent_on_drive_and_when_idle', async () => {
    setViewportWidth(1440);
    trainingApi().install();
    const drive = renderApp({ path: '/drive' });
    await sendLiveState(drive, { mode: 'armed', exerciseId: EXERCISE_ID });
    expect(screen.queryByRole('status', { name: 'Training' })).toBeNull();
    drive.unmount();
    const idle = renderApp({ path: '/exercises/e0000000-0000-4000-8000-000000000001/attempts' });
    await sendLiveState(idle, { mode: 'idle', exerciseId: null });
    await screen.findByRole('navigation', { name: 'Exercise' });
    expect(screen.queryByRole('status', { name: 'Training' })).toBeNull();
    await sendLiveState(idle, { mode: 'capturing', exerciseId: EXERCISE_ID });
    expect(screen.queryByRole('status', { name: 'Training' })).toBeNull();
  });

  it('stop_training_calls_disarm_once', async () => {
    setViewportWidth(1440);
    const api = trainingApi().on('POST /api/training/disarm', { status: 201, body: { ok: true } }).install();
    const view = renderApp({ path: REVIEW_PATH });
    await sendLiveState(view, { mode: 'armed', exerciseId: EXERCISE_ID });
    await userEvent.setup().click(within(await screen.findByRole('status', { name: 'Training' })).getByRole('button', { name: 'Stop training' }));
    await waitFor(() => expect(api.calls.filter(call => call.method === 'POST' && call.path === '/api/training/disarm')).toHaveLength(1));
  });

  it('bar_names_a_running_attempt', async () => {
    setViewportWidth(1440);
    trainingApi().install();
    const view = renderApp({ path: REVIEW_PATH });
    await sendLiveState(view, { mode: 'driving', exerciseId: EXERCISE_ID, attemptNumber: 10 });
    const bar = await screen.findByRole('status', { name: 'Training' });
    await waitFor(() => expect(bar).toHaveTextContent(`Attempt 10 runs: ${NAME}. Stop training ends it without a time.`));
  });

  it('failed_stop_shows_the_error_in_the_bar', async () => {
    setViewportWidth(1440);
    trainingApi().on('POST /api/training/disarm', { status: 500, body: { message: 'Server problem' } }).install();
    const view = renderApp({ path: REVIEW_PATH });
    await sendLiveState(view, { mode: 'armed', exerciseId: EXERCISE_ID });
    await userEvent.setup().click(within(await screen.findByRole('status', { name: 'Training' })).getByRole('button', { name: 'Stop training' }));
    expect(await within(screen.getByRole('status', { name: 'Training' })).findByRole('alert')).toBeInTheDocument();
  });

  it('stop_treats_not_armed_as_done', async () => {
    setViewportWidth(1440);
    trainingApi().on('POST /api/training/disarm', { status: 409, body: { code: 'not-armed', message: 'No training runs for this profile.' } }).install();
    const view = renderApp({ path: REVIEW_PATH });
    await sendLiveState(view, { mode: 'armed', exerciseId: EXERCISE_ID });
    const user = userEvent.setup();
    await user.click(within(await screen.findByRole('status', { name: 'Training' })).getByRole('button', { name: 'Stop training' }));
    await waitFor(() => expect(within(screen.getByRole('status', { name: 'Training' })).getByRole('button', { name: 'Stop training' })).toBeEnabled());
    expect(within(screen.getByRole('status', { name: 'Training' })).queryByRole('alert')).toBeNull();
  });
});
