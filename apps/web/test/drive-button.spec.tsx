import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { AppInfo } from '@gt7/contracts';
import { voiceDeviceId } from '../src/voice/device.ts';
import { EXERCISE_ID, exercise, exerciseApi, REFERENCE_CLIPS, rememberExercise } from './fixtures.ts';
import { ATTEMPT_LIST } from './review-fixtures.ts';
import { liveState, openLive, playerRig, renderApp, setViewportWidth, type ApiStub, findEl, el } from './support.tsx';

const ATTEMPTS_PATH = `/exercises/${EXERCISE_ID}/attempts`;
const DRIVE_PATH = `/exercises/${EXERCISE_ID}/drive`;
const ARMED = { captureId: 'cap-9', exerciseId: EXERCISE_ID, referenceId: 'ref-demo' };
const OTHER = exercise({ id: 'e0000000-0000-4000-8000-000000000002', name: 'Cornering Basics 1' });
const DEMO: AppInfo = { demo: { profileName: 'demo', password: 'demodemo', ready: true }, consoleRequired: false };

function startApi(): ApiStub {
  rememberExercise();
  return exerciseApi(exercise({ step: 3, completeAttempts: 2, bestMs: 26800 }))
    .on(`GET /api/exercises/${EXERCISE_ID}/attempts`, ATTEMPT_LIST)
    .on('POST /api/training/arm', { status: 201, body: ARMED })
    .on('POST /api/training/disarm', { status: 201, body: { ok: true } });
}

function driveButton(): HTMLElement {
  return screen.getByRole('button', { name: 'Drive' });
}

function routes(api: ApiStub, wanted: string[]): string[] {
  return api.calls.map(call => `${call.method} ${call.path}`).filter(route => wanted.includes(route));
}

describe('drive button', () => {
  it('drive_is_one_yellow_button_without_an_icon', async () => {
    startApi().install();
    const view = renderApp({ path: ATTEMPTS_PATH });
    await openLive(view.sockets, liveState());
    const drive = await screen.findByRole('button', { name: 'Drive' });
    expect(drive).toHaveTextContent(/^Drive$/);
    expect(drive).toHaveClass('btn', 'yellow', 'drive-button');
    expect(drive.querySelector('[data-icon]')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Drive' })).toBeNull();
  });

  it('drive_arms_and_opens_the_stage', async () => {
    const api = startApi().install();
    const view = renderApp({ path: ATTEMPTS_PATH });
    const socket = await openLive(view.sockets, liveState({ connection: 'connected' }));
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Drive' }));
    await waitFor(() => expect(window.location.pathname).toBe(DRIVE_PATH));
    expect(api.calls.find(call => call.path === '/api/training/arm')?.body).toEqual({ exerciseId: EXERCISE_ID });
    expect(api.called('POST /api/demo/attempt')).toBe(false);
    expect(await screen.findByRole('button', { name: 'Stop training' })).toBeInTheDocument();
    act(() => socket.receive({ type: 'state', state: liveState({ seq: 2, connection: 'connected', mode: 'armed', exerciseId: EXERCISE_ID, referenceId: 'ref-demo' }) }));
    expect(el('[role="status"].cue')).toHaveTextContent('READY');
    expect(window.location.pathname).toBe(DRIVE_PATH);
  });

  it('drive_preloads_the_clips_when_this_device_plays_the_voice', async () => {
    const api = startApi().install();
    const rig = playerRig();
    await rig.player.unlock();
    const preload = vi.spyOn(rig.player, 'preload').mockResolvedValue(undefined);
    const view = renderApp({ path: ATTEMPTS_PATH, player: rig.player });
    await openLive(view.sockets, liveState({ voiceDeviceId: voiceDeviceId(), voiceReady: true }));
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Drive' }));
    await waitFor(() => expect(api.called('POST /api/training/arm')).toBe(true));
    expect(preload).toHaveBeenCalledWith(REFERENCE_CLIPS);
    const clipsIndex = api.calls.findIndex(call => call.path === '/api/references/ref-demo/clips');
    const armIndex = api.calls.findIndex(call => call.path === '/api/training/arm');
    expect(clipsIndex).toBeGreaterThanOrEqual(0);
    expect(clipsIndex).toBeLessThan(armIndex);
  });

  it('drive_does_not_load_clips_without_the_voice_here', async () => {
    const api = startApi().install();
    const view = renderApp({ path: ATTEMPTS_PATH });
    await openLive(view.sockets, liveState({ voiceDeviceId: 'phone', voiceReady: true }));
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Drive' }));
    await waitFor(() => expect(api.called('POST /api/training/arm')).toBe(true));
    expect(api.called('GET /api/references/ref-demo/clips')).toBe(false);
  });

  it('failed_clips_still_arm_and_show_on_the_stage', async () => {
    const api = startApi().install();
    const rig = playerRig();
    await rig.player.unlock();
    vi.spyOn(rig.player, 'preload').mockRejectedValue(new Error('HTTP 500'));
    const view = renderApp({ path: ATTEMPTS_PATH, player: rig.player });
    await openLive(view.sockets, liveState({ voiceDeviceId: voiceDeviceId(), voiceReady: true }));
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Drive' }));
    await waitFor(() => expect(api.called('POST /api/training/arm')).toBe(true));
    expect(await screen.findByText('The voice clips did not load. Reload the page.')).toBeInTheDocument();
    expect(document.querySelector('.drive-stage')).not.toBeNull();
  });

  it('drive_in_the_demo_selects_the_demo_attempt_first', async () => {
    setViewportWidth(390);
    const api = startApi().on('GET /api/app-info', DEMO).on('POST /api/demo/attempt', { status: 201, body: { fixture: 'ce-clean' } }).install();
    const view = renderApp({ path: ATTEMPTS_PATH });
    await openLive(view.sockets, liveState());
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Drive' }));
    await waitFor(() => expect(api.called('POST /api/training/arm')).toBe(true));
    expect(routes(api, ['POST /api/demo/attempt', 'POST /api/training/arm'])).toEqual(['POST /api/demo/attempt', 'POST /api/training/arm']);
  });

  it('arm_failure_shows_under_the_button', async () => {
    startApi().on('POST /api/training/arm', { status: 409, body: { code: 'no-reference' } }).install();
    const view = renderApp({ path: ATTEMPTS_PATH });
    await openLive(view.sockets, liveState());
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Drive' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Record and confirm a reference first.');
    expect(driveButton().compareDocumentPosition(alert) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(window.location.pathname).toBe(ATTEMPTS_PATH);
  });

  it('drive_of_the_exercise_in_training_opens_the_stage_without_arming', async () => {
    const api = startApi().install();
    const view = renderApp({ path: ATTEMPTS_PATH });
    await openLive(view.sockets, liveState({ connection: 'connected', mode: 'armed', exerciseId: EXERCISE_ID, referenceId: 'ref-demo' }));
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Drive' }));
    await waitFor(() => expect(window.location.pathname).toBe(DRIVE_PATH));
    expect(api.called('POST /api/training/arm')).toBe(false);
  });

  it('training_of_another_exercise_asks_first_and_cancel_keeps_it', async () => {
    const api = startApi().on('GET /api/exercises', [exercise(), OTHER]).install();
    const view = renderApp({ path: ATTEMPTS_PATH });
    await openLive(view.sockets, liveState({ connection: 'connected', mode: 'armed', exerciseId: OTHER.id, referenceId: 'ref-demo' }));
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Drive' }));
    const dialog = await screen.findByRole('alertdialog');
    await waitFor(() => expect(within(dialog).getByRole('heading', { level: 2 })).toHaveTextContent(/^The training of Cornering Basics 1 is on\.$/));
    expect(dialog).toHaveTextContent('Stop it and start this exercise?');
    expect(within(dialog).getAllByRole('button').map(button => button.textContent)).toEqual(['Cancel', 'Stop and start']);
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(api.called('POST /api/training/disarm')).toBe(false);
    expect(api.called('POST /api/training/arm')).toBe(false);
    expect(window.location.pathname).toBe(ATTEMPTS_PATH);
  });

  it('stop_and_start_disarms_then_arms', async () => {
    const api = startApi().on('GET /api/exercises', [exercise(), OTHER]).install();
    const view = renderApp({ path: ATTEMPTS_PATH });
    await openLive(view.sockets, liveState({ connection: 'connected', mode: 'armed', exerciseId: OTHER.id, referenceId: 'ref-demo' }));
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Drive' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Stop and start' }));
    await waitFor(() => expect(window.location.pathname).toBe(DRIVE_PATH));
    expect(routes(api, ['POST /api/training/disarm', 'POST /api/training/arm'])).toEqual(['POST /api/training/disarm', 'POST /api/training/arm']);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('running_attempt_of_another_exercise_blocks_the_start', async () => {
    const api = startApi().on('GET /api/exercises', [exercise(), OTHER]).install();
    const view = renderApp({ path: ATTEMPTS_PATH });
    await openLive(view.sockets, liveState({ connection: 'connected', mode: 'driving', attemptNumber: 4, exerciseId: OTHER.id, referenceId: 'ref-demo' }));
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Drive' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Attempt 4 runs. Finish it or stop the training first.');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(api.called('POST /api/training/disarm')).toBe(false);
    expect(api.called('POST /api/training/arm')).toBe(false);
  });

  it('failed_stop_shows_in_the_dialog', async () => {
    const api = startApi()
      .on('GET /api/exercises', [exercise(), OTHER])
      .on('POST /api/training/disarm', { status: 500, body: { code: 'server-error' } })
      .install();
    const view = renderApp({ path: ATTEMPTS_PATH });
    await openLive(view.sockets, liveState({ connection: 'connected', mode: 'armed', exerciseId: OTHER.id, referenceId: 'ref-demo' }));
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Drive' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Stop and start' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Something went wrong in GT7 Tutor (status 500).');
    expect(api.called('POST /api/training/arm')).toBe(false);
  });
});

describe('drive on attempts', () => {
  it('desktop_puts_select_and_hide_aborted_into_the_first_day_heading', async () => {
    setViewportWidth(1440);
    startApi().install();
    renderApp({ path: ATTEMPTS_PATH });
    const select = await screen.findByRole('button', { name: 'Select' });
    const heading = document.querySelector('.attempt-day-head')!;
    expect(heading).not.toBeNull();
    expect(heading.querySelector('h2')).not.toBeNull();
    expect(heading).toContainElement(select);
    expect(heading).toContainElement(screen.getByRole('button', { name: 'Hide aborted' }));
    const drive = driveButton();
    expect(drive.closest('.attempts-drive')).not.toBeNull();
    expect(drive.compareDocumentPosition(screen.getByRole('heading', { name: 'Recurring differences' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('phone_puts_drive_first_then_select_and_hide_aborted', async () => {
    setViewportWidth(390);
    startApi().install();
    renderApp({ path: ATTEMPTS_PATH });
    const select = await screen.findByRole('button', { name: 'Select' });
    const drive = driveButton();
    const day = screen.getAllByRole('heading', { level: 2 })[0]!;
    expect(drive.compareDocumentPosition(select) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(select.compareDocumentPosition(day) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(document.querySelector('.attempt-day-head')?.contains(select) ?? false).toBe(false);
  });

  it('empty_list_says_select_drive_and_has_no_open_drive', async () => {
    exerciseApi(exercise({ attemptCount: 0 })).install();
    renderApp({ path: ATTEMPTS_PATH });
    expect(await screen.findByText('No attempts yet. Select Drive, then drive the exercise in the game.')).toBeInTheDocument();
    expect(driveButton()).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open Drive' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Recurring differences' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Select' })).toBeNull();
  });

  it('no_reference_shows_record_in_place_of_drive', async () => {
    exerciseApi(exercise({ activeReferenceId: null, step: 1 })).install();
    renderApp({ path: ATTEMPTS_PATH });
    expect(await screen.findByText('Record the reference first.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Record' })).toHaveAttribute('href', `/exercises/${EXERCISE_ID}/record`);
    expect(screen.queryByRole('button', { name: 'Drive' })).toBeNull();
  });

  it('cues_and_references_have_no_drive_button', async () => {
    for (const path of [`/exercises/${EXERCISE_ID}/cues`, `/exercises/${EXERCISE_ID}/references`]) {
      const api = startApi().install();
      const view = renderApp({ path });
      await findEl('nav.exercise-tabs');
      await act(async () => undefined);
      expect(screen.queryByRole('button', { name: 'Drive' }), path).toBeNull();
      expect(screen.queryByRole('link', { name: 'Drive' }), path).toBeNull();
      expect(api.called('POST /api/training/arm')).toBe(false);
      view.unmount();
    }
  });
});
