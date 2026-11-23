import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { EXERCISE_ID, exerciseApi, rememberExercise } from './fixtures.ts';
import { attemptSummary, ATTEMPT_ID, REVIEW_PATH } from './review-fixtures.ts';
import { renderApp, sendLiveState, setViewportWidth, findEl, maybeElWith, findElWith, elWith } from './support.tsx';

const NAME = 'Yangwang, EXP-1';

function trainingApi() {
  rememberExercise();
  return exerciseApi().on(`GET /api/attempts/${ATTEMPT_ID}`, attemptSummary());
}

describe('running training', () => {
  it('bar_shows_on_every_screen_but_drive', async () => {
    trainingApi().install();
    const view = renderApp({ path: REVIEW_PATH });
    await sendLiveState(view, { mode: 'finished', exerciseId: EXERCISE_ID });
    const bar = await findElWith('.running-bar', 'Stop training');
    await waitFor(() => expect(bar).toHaveTextContent(`The training is on: ${NAME}. Restart the exercise in GT7 to drive the next attempt.`));
    expect(within(bar).getByRole('link', { name: 'Open Drive' })).toHaveAttribute('href', `/exercises/${EXERCISE_ID}/drive`);
    expect(within(bar).getByRole('button', { name: 'Stop training' })).toBeInTheDocument();
  });

  it('bar_on_a_phone_loads_the_name_and_keeps_the_short_text', async () => {
    setViewportWidth(390);
    const api = trainingApi().install();
    const view = renderApp({ path: `/exercises/${EXERCISE_ID}/attempts` });
    await findEl('nav.exercise-tabs');
    expect(api.calls.filter(call => call.method === 'GET' && call.path === '/api/exercises')).toHaveLength(0);
    await sendLiveState(view, { mode: 'armed', exerciseId: EXERCISE_ID });
    const bar = await findElWith('.running-bar', 'Stop training');
    await waitFor(() => expect(bar.querySelector('.running-bar-text')).toHaveTextContent(`The training is on: ${NAME}.`));
    expect(bar).not.toHaveTextContent('Restart the exercise');
  });

  it('bar_without_a_known_name_still_shows', async () => {
    trainingApi().install();
    const view = renderApp({ path: '/' });
    await sendLiveState(view, { mode: 'armed', exerciseId: 'e0000000-0000-4000-8000-000000000099' });
    expect(await findElWith('.running-bar', 'Stop training')).toHaveTextContent('The training is on. Restart the exercise in GT7 to drive the next attempt.');
  });

  it('bar_shows_on_the_drive_page_of_another_exercise', async () => {
    trainingApi().install();
    const view = renderApp({ path: '/exercises/e0000000-0000-4000-8000-000000000002/drive' });
    await sendLiveState(view, { mode: 'armed', exerciseId: EXERCISE_ID });
    const bar = await findElWith('.running-bar', 'Stop training');
    expect(within(bar).getByRole('link', { name: 'Open Drive' })).toHaveAttribute('href', `/exercises/${EXERCISE_ID}/drive`);
  });

  it('bar_is_absent_on_drive_and_when_idle', async () => {
    trainingApi().install();
    const drive = renderApp({ path: `/exercises/${EXERCISE_ID}/drive` });
    await sendLiveState(drive, { mode: 'armed', exerciseId: EXERCISE_ID });
    expect(maybeElWith('.running-bar', 'Stop training')).toBeNull();
    drive.unmount();
    const idle = renderApp({ path: `/exercises/${EXERCISE_ID}/attempts` });
    await sendLiveState(idle, { mode: 'idle', exerciseId: null });
    await findEl('nav.exercise-tabs');
    expect(maybeElWith('.running-bar', 'Stop training')).toBeNull();
    await sendLiveState(idle, { mode: 'capturing', exerciseId: EXERCISE_ID });
    expect(maybeElWith('.running-bar', 'Stop training')).toBeNull();
  });

  it('stop_training_calls_disarm_once', async () => {
    const api = trainingApi().on('POST /api/training/disarm', { status: 201, body: { ok: true } }).install();
    const view = renderApp({ path: REVIEW_PATH });
    await sendLiveState(view, { mode: 'armed', exerciseId: EXERCISE_ID });
    await userEvent.setup().click(within(await findElWith('.running-bar', 'Stop training')).getByRole('button', { name: 'Stop training' }));
    await waitFor(() => expect(api.calls.filter(call => call.method === 'POST' && call.path === '/api/training/disarm')).toHaveLength(1));
  });

  it('bar_names_a_running_attempt', async () => {
    trainingApi().install();
    const view = renderApp({ path: REVIEW_PATH });
    await sendLiveState(view, { mode: 'driving', exerciseId: EXERCISE_ID, attemptNumber: 10 });
    const bar = await findElWith('.running-bar', 'Stop training');
    await waitFor(() => expect(bar).toHaveTextContent(`Attempt 10 runs: ${NAME}. Stop training ends it without a time.`));
  });

  it('failed_stop_shows_the_error_in_the_bar', async () => {
    trainingApi().on('POST /api/training/disarm', { status: 500, body: { code: 'server-error' } }).install();
    const view = renderApp({ path: REVIEW_PATH });
    await sendLiveState(view, { mode: 'armed', exerciseId: EXERCISE_ID });
    await userEvent.setup().click(within(await findElWith('.running-bar', 'Stop training')).getByRole('button', { name: 'Stop training' }));
    expect(await within(elWith('.running-bar', 'Stop training')).findByRole('alert')).toBeInTheDocument();
  });

  it('stop_treats_not_armed_as_done', async () => {
    trainingApi().on('POST /api/training/disarm', { status: 409, body: { code: 'not-armed' } }).install();
    const view = renderApp({ path: REVIEW_PATH });
    await sendLiveState(view, { mode: 'armed', exerciseId: EXERCISE_ID });
    const user = userEvent.setup();
    await user.click(within(await findElWith('.running-bar', 'Stop training')).getByRole('button', { name: 'Stop training' }));
    await waitFor(() => expect(within(elWith('.running-bar', 'Stop training')).getByRole('button', { name: 'Stop training' })).toBeEnabled());
    expect(within(elWith('.running-bar', 'Stop training')).queryByRole('alert')).toBeNull();
  });
});
