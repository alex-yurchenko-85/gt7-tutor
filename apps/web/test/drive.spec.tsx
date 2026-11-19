import { act, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KPH_PER_MPS, type AttemptSummary, type LiveState } from '@gt7/contracts';
import { useMissedStart } from '../src/features/drive/missed-start.ts';
import { voiceDeviceId } from '../src/voice/device.ts';
import { exercise, exerciseApi, REFERENCE_CLIPS, rememberExercise } from './fixtures.ts';
import { cue, liveState, playerRig, renderApp, setViewportWidth, type ApiStub, type FakeSocket } from './support.tsx';

const ARMED_CLIPS = REFERENCE_CLIPS;

const ARMED = { captureId: 'cap-9', exerciseId: 'e0000000-0000-4000-8000-000000000001', referenceId: 'ref-demo' };

function driveApi(): ApiStub {
  rememberExercise();
  return exerciseApi(exercise({ step: 3 }))
    .on('POST /api/training/arm', { status: 201, body: ARMED })
    .on('POST /api/training/disarm', { status: 201, body: { ok: true } });
}

function driving(overrides: Partial<LiveState> = {}): LiveState {
  return liveState({
    mode: 'driving',
    connection: 'connected',
    exerciseId: 'e0000000-0000-4000-8000-000000000001',
    attemptNumber: 2,
    sM: 300,
    speedMps: 142 / KPH_PER_MPS,
    referenceId: 'ref-demo',
    ...overrides
  });
}

async function openDrive(path = '/drive', state: LiveState = liveState()) {
  const view = renderApp({ path });
  await screen.findByRole('heading', { name: 'Drive' });
  const socket = await waitFor(() => view.sockets.latest);
  act(() => {
    socket.open();
    socket.receive({ type: 'state', state });
  });
  return { ...view, socket };
}

function send(socket: FakeSocket, state: LiveState) {
  act(() => socket.receive({ type: 'state', state }));
}

describe('drive', () => {
  it('drive_shows_one_cue_and_next_cue', async () => {
    setViewportWidth(390);
    driveApi().install();
    await openDrive('/drive', driving({ lastCue: cue({ kind: 'brake', targetSpeedKph: 85 }), nextCue: { text: 'Full throttle', inM: 120 } }));
    const current = screen.getByRole('status', { name: 'Current cue' });
    expect(current).toHaveTextContent('Brake85');
    expect(screen.getAllByRole('status', { name: 'Current cue' })).toHaveLength(1);
    expect(screen.getByText('Next: Full throttle')).toBeInTheDocument();
    expect(screen.getByText('in 120 m')).toBeInTheDocument();
    expect(screen.getByText('142')).toBeInTheDocument();
  });

  it('drive_shows_the_live_speed_in_kmh', async () => {
    setViewportWidth(390);
    driveApi().install();
    await openDrive('/drive', driving({ speedMps: 141.6 / KPH_PER_MPS }));
    expect(screen.getByText('142')).toBeInTheDocument();
  });

  it('drive_is_dark_in_light_theme', async () => {
    setViewportWidth(390);
    document.documentElement.dataset.theme = 'light';
    driveApi().install();
    await openDrive('/drive', driving());
    expect(document.querySelector('.drive-stage')).toHaveAttribute('data-surface', 'night');
  });

  it('voice_off_is_visible_and_one_click_arms_without_a_voice_device', async () => {
    setViewportWidth(1280);
    const api = driveApi().install();
    await openDrive('/drive', liveState({ voiceDeviceId: null }));
    expect(screen.getByRole('heading', { name: 'The voice is off' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Attempt type' })).not.toBeInTheDocument();
    expect(screen.queryByText('Attempt type')).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Start an attempt' }));
    await waitFor(() => expect(api.calls.find(call => call.path === '/api/training/arm')?.body).toEqual({ exerciseId: 'e0000000-0000-4000-8000-000000000001' }));
    expect(screen.queryByText(/No device plays the voice/)).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/baseline|guided|without voice|No device plays the voice/i);
  });

  it('arming_preloads_reference_clips_first', async () => {
    setViewportWidth(1280);
    const api = driveApi().install();
    const rig = playerRig();
    await rig.player.unlock();
    const order: string[] = [];
    const preload = vi.spyOn(rig.player, 'preload').mockImplementation(async keys => {
      order.push(`preload:${[...keys].sort().join(',')}`);
    });
    const view = renderApp({ path: '/drive', player: rig.player });
    await screen.findByRole('heading', { name: 'Drive' });
    await waitFor(() => view.sockets.latest);
    act(() => {
      view.sockets.latest.open();
      view.sockets.latest.receive({ type: 'state', state: liveState({ voiceDeviceId: voiceDeviceId(), voiceReady: true }) });
    });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Start an attempt' }));
    await waitFor(() => expect(api.called('POST /api/training/arm')).toBe(true));
    expect(preload).toHaveBeenCalledTimes(1);
    expect(order[0]).toBe(`preload:${[...ARMED_CLIPS].sort().join(',')}`);
    const armIndex = api.calls.findIndex(call => call.path === '/api/training/arm');
    const clipsIndex = api.calls.findIndex(call => call.path === '/api/references/ref-demo/clips');
    expect(clipsIndex).toBeGreaterThanOrEqual(0);
    expect(clipsIndex).toBeLessThan(armIndex);
    expect(api.calls.find(call => call.path === '/api/training/arm')?.body).toEqual({ exerciseId: 'e0000000-0000-4000-8000-000000000001' });
  });

  it('clip_load_failure_shows_a_voice_warning_and_still_arms', async () => {
    setViewportWidth(1280);
    const api = driveApi().install();
    const rig = playerRig();
    await rig.player.unlock();
    vi.spyOn(rig.player, 'preload').mockRejectedValue(new Error('The voice clips did not load. Reload the page.'));
    const view = renderApp({ path: '/drive', player: rig.player });
    await screen.findByRole('heading', { name: 'Drive' });
    await waitFor(() => view.sockets.latest);
    act(() => {
      view.sockets.latest.open();
      view.sockets.latest.receive({ type: 'state', state: liveState({ voiceDeviceId: voiceDeviceId(), voiceReady: true }) });
    });
    expect(await screen.findByText('The voice clips did not load. Reload the page.')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Start an attempt' }));
    await waitFor(() => expect(api.called('POST /api/training/arm')).toBe(true));
    expect(await screen.findByText('The voice clips did not load. Reload the page.')).toBeInTheDocument();
  });

  it('clip_load_failure_hides_the_loading_line', async () => {
    setViewportWidth(1280);
    driveApi().install();
    const rig = playerRig();
    await rig.player.unlock();
    vi.spyOn(rig.player, 'preload').mockRejectedValue(new Error('The voice clips did not load. Reload the page.'));
    const view = renderApp({ path: '/drive', player: rig.player });
    await screen.findByRole('heading', { name: 'Drive' });
    await waitFor(() => view.sockets.latest);
    act(() => {
      view.sockets.latest.open();
      view.sockets.latest.receive({ type: 'state', state: liveState({ voiceDeviceId: voiceDeviceId(), voiceReady: true }) });
    });
    expect(await screen.findByText('The voice clips did not load. Reload the page.')).toBeInTheDocument();
    expect(screen.queryByText('Loading the cues…')).not.toBeInTheDocument();
  });

  it('clip_failure_alert_goes_when_the_voice_moves_to_another_device', async () => {
    setViewportWidth(1280);
    const api = driveApi().install();
    const rig = playerRig();
    await rig.player.unlock();
    vi.spyOn(rig.player, 'preload').mockRejectedValue(new Error('The voice clips did not load. Reload the page.'));
    const view = renderApp({ path: '/drive', player: rig.player });
    await screen.findByRole('heading', { name: 'Drive' });
    await waitFor(() => view.sockets.latest);
    act(() => {
      view.sockets.latest.open();
      view.sockets.latest.receive({ type: 'state', state: liveState({ voiceDeviceId: voiceDeviceId(), voiceReady: true }) });
    });
    await screen.findByText('The voice clips did not load. Reload the page.');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Start an attempt' }));
    await waitFor(() => expect(api.called('POST /api/training/arm')).toBe(true));
    const armed = { seq: 2, mode: 'armed' as const, exerciseId: 'e0000000-0000-4000-8000-000000000001', referenceId: 'ref-demo', voiceReady: true };
    act(() => view.sockets.latest.receive({ type: 'state', state: liveState({ ...armed, voiceDeviceId: voiceDeviceId() }) }));
    expect(await screen.findByText('The voice clips did not load. Reload the page.')).toBeInTheDocument();
    act(() => view.sockets.latest.receive({ type: 'state', state: liveState({ ...armed, seq: 3, voiceDeviceId: 'phone' }) }));
    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();
    expect(screen.queryByText('The voice clips did not load. Reload the page.')).not.toBeInTheDocument();
  });

  it('connection_lost_clears_cue_and_says_so', async () => {
    setViewportWidth(390);
    driveApi().install();
    const { socket } = await openDrive('/drive', driving({ lastCue: cue() }));
    expect(screen.getByRole('status', { name: 'Current cue' })).toHaveTextContent('Brake');
    send(socket, driving({ seq: 2, connection: 'disconnected', lastCue: cue() }));
    expect(screen.getByRole('status', { name: 'Current cue' })).not.toHaveTextContent('Brake');
    expect(screen.getByText(/No packets from the console/)).toBeInTheDocument();
    expect(screen.queryByText('142')).not.toBeInTheDocument();
    act(() => socket.close(1006));
    expect(screen.getByText(/Connection to GT7 Tutor lost/)).toBeInTheDocument();
  });

  it('paused_and_guidance_suspended_states_have_text', async () => {
    setViewportWidth(390);
    driveApi().install();
    const { socket } = await openDrive('/drive', driving({ mode: 'paused' }));
    expect(screen.getByText(/Paused\. Cues stop until you continue/)).toBeInTheDocument();
    send(socket, driving({ seq: 2, guidance: { mode: 'suspended', reason: 'untrusted-position' } }));
    expect(screen.getByText(/too far from the reference line/)).toBeInTheDocument();
    send(socket, driving({ seq: 3, guidance: { mode: 'waiting-for-restart', reason: 'awaiting-restart' } }));
    expect(screen.getByText(/Restart the attempt to get cues again/)).toBeInTheDocument();
  });

  it('drive_view_shows_the_armed_exercise_not_the_remembered_one', async () => {
    setViewportWidth(390);
    const basics = exercise({ id: 'e0000000-0000-4000-8000-000000000002', name: 'Cornering Basics 1', activeReferenceId: null, step: 1 });
    driveApi().on('GET /api/exercises', [exercise({ step: 3 }), basics]).install();
    rememberExercise(basics.id);
    const { socket } = await openDrive('/drive', driving({ lastCue: cue({ kind: 'brake', targetSpeedKph: 85 }) }));
    expect(await screen.findByText('142')).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Current cue' })).toHaveTextContent('Brake85');
    expect(screen.queryByText('This exercise has no reference yet. Record it first.')).not.toBeInTheDocument();
    send(socket, liveState({ mode: 'idle', exerciseId: null, seq: 99 }));
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(screen.queryByText('This exercise has no reference yet. Record it first.')).not.toBeInTheDocument();
  });

  it('voice_device_loads_clips_when_training_is_armed_elsewhere', async () => {
    setViewportWidth(1280);
    driveApi().install();
    const rig = playerRig();
    const preload = vi.spyOn(rig.player, 'preload').mockResolvedValue(undefined);
    const view = renderApp({ path: '/setup', player: rig.player });
    await screen.findByRole('heading', { name: 'Setup' });
    await waitFor(() => view.sockets.latest);
    act(() => {
      view.sockets.latest.open();
      view.sockets.latest.receive({ type: 'state', state: liveState({ voiceDeviceId: voiceDeviceId(), voiceReady: true }) });
    });
    expect(preload).not.toHaveBeenCalled();
    act(() =>
      view.sockets.latest.receive({
        type: 'state',
        state: liveState({ seq: 2, mode: 'armed', exerciseId: 'e0000000-0000-4000-8000-000000000001', referenceId: 'ref-demo', voiceDeviceId: voiceDeviceId(), voiceReady: true })
      })
    );
    await waitFor(() => expect(preload).toHaveBeenCalledWith(ARMED_CLIPS));
  });

  it('voice_player_preloads_the_reference_clips', async () => {
    setViewportWidth(1280);
    const api = driveApi().on('GET /api/references/ref-demo/clips', ['hard-brake', 'speed-85', 'voice-check']).install();
    const rig = playerRig();
    const view = renderApp({ path: '/setup', player: rig.player });
    await screen.findByRole('heading', { name: 'Setup' });
    await waitFor(() => view.sockets.latest);
    act(() => {
      view.sockets.latest.open();
      view.sockets.latest.receive({
        type: 'state',
        state: liveState({ mode: 'armed', exerciseId: 'e0000000-0000-4000-8000-000000000001', referenceId: 'ref-demo', voiceDeviceId: voiceDeviceId(), voiceReady: true })
      });
    });
    await waitFor(() => expect(['hard-brake', 'speed-85', 'voice-check'].every(clip => rig.player.hasClip(clip))).toBe(true));
    expect(api.called('GET /api/references/ref-demo/clips')).toBe(true);
    expect(api.called('GET /api/references/ref-demo/cues')).toBe(false);
  });

  it('every_attempt_shows_the_next_cue_without_a_voice_device', async () => {
    setViewportWidth(390);
    driveApi().install();
    await openDrive('/drive', driving({ voiceDeviceId: null, lastCue: null, nextCue: { text: 'Brake to eighty five', inM: 50 } }));
    expect(screen.getByText('Next: Brake to eighty five')).toBeInTheDocument();
    expect(screen.getByText('in 50 m')).toBeInTheDocument();
    expect(screen.queryByText('No voice')).not.toBeInTheDocument();
  });
});

const ATTEMPT: AttemptSummary = {
  id: 'a0000000-0000-4000-8000-000000000001',
  exerciseId: 'e0000000-0000-4000-8000-000000000001',
  number: 2,
  referenceId: 'ref-demo',
  captureId: 'cap-9',
  first: 1162,
  last: 2786,
  completion: 'complete',
  reason: null,
  timeMs: 27100,
  gapToBestMs: 350,
  largestDifference: { kind: 'brake-early', eventKey: 'brake@332', sM: 332, size: 14.2, unit: 'm', turn: 1 },
  focus: null,
  startedAt: '2026-11-16T11:23:30.000Z'
};

describe('action cues on Drive', () => {
  it('drive_shows_action_word_and_target', async () => {
    setViewportWidth(390);
    driveApi().install();
    const { socket } = await openDrive('/drive', driving({ lastCue: cue({ id: 'c1', kind: 'hard-brake', targetSpeedKph: 85, clip: 'hard-brake' }) }));
    const current = () => screen.getByRole('status', { name: 'Current cue' });
    expect(current()).toHaveTextContent('Hard brake85');
    send(socket, driving({ seq: 2, lastCue: cue({ id: 'c2', kind: 'full-throttle', targetSpeedKph: 95, clip: 'full-throttle' }) }));
    expect(current()).toHaveTextContent('Full throttle95');
    send(socket, driving({ seq: 3, lastCue: cue({ id: 'c3', kind: 'tighter', targetSpeedKph: null, clip: 'tighter' }) }));
    expect(current()).toHaveTextContent(/^Tighter$/);
    send(socket, driving({ seq: 4, lastCue: cue({ id: 'c4', kind: 'big-stop', targetSpeedKph: null, clip: 'big-stop' }) }));
    expect(current()).toHaveTextContent(/^Big stop$/);
    send(socket, driving({ seq: 5, lastCue: cue({ id: 'c5', kind: 'light-brake', targetSpeedKph: 120, clip: 'light-brake' }) }));
    expect(current()).toHaveTextContent('Light brake120');
  });

  it('drive_does_not_show_the_focus_cue', async () => {
    setViewportWidth(390);
    driveApi().install();
    await openDrive('/drive', driving({ lastCue: cue({ id: 'f1', kind: 'focus', eventKey: 'focus', targetSpeedKph: null, clip: 'focus-brake-early-1' }) }));
    const current = screen.getByRole('status', { name: 'Current cue' });
    expect(current).toHaveTextContent(/^$/);
    expect(current).toHaveClass('idle');
  });
});

describe('attempt summary', () => {
  function summaryApi(): ApiStub {
    return driveApi().on('GET /api/attempts/a0000000-0000-4000-8000-000000000001', ATTEMPT).install();
  }

  it('summary_appears_on_finished_with_time_gap_and_largest_difference', async () => {
    setViewportWidth(390);
    summaryApi();
    await openDrive('/drive', driving({ mode: 'finished', lastAttemptId: 'a0000000-0000-4000-8000-000000000001' }));
    const summary = await screen.findByRole('region', { name: 'Attempt 2' });
    expect(summary).toHaveTextContent('0:27.100');
    expect(summary).toHaveTextContent('+0.35 s');
    expect(summary).toHaveTextContent('332 m. Braked 14 m earlier');
    expect(screen.getByRole('link', { name: 'Review this attempt' })).toHaveAttribute('href', '/attempts/a0000000-0000-4000-8000-000000000001/review');
  });

  it('summary_shows_the_focus_sentence', async () => {
    setViewportWidth(390);
    driveApi()
      .on('GET /api/attempts/a0000000-0000-4000-8000-000000000001', { ...ATTEMPT, focus: { text: 'Turn one. Brake later.', turn: 1, kind: 'brake-early' } })
      .install();
    await openDrive('/drive', driving({ mode: 'finished', lastAttemptId: 'a0000000-0000-4000-8000-000000000001' }));
    const summary = await screen.findByRole('region', { name: 'Attempt 2' });
    expect(within(summary).getByText('Turn one. Brake later.')).toBeInTheDocument();
    expect(summary).toHaveTextContent('Focus for the next attempt');
    expect(within(summary).getByText('A difference from the reference.')).toBeInTheDocument();
    expect(within(summary).queryByText(/mistake/i)).toBeNull();
  });

  it('summary_title_is_the_attempt_number_without_voice_text', async () => {
    setViewportWidth(1280);
    summaryApi();
    await openDrive('/drive', driving({ mode: 'finished', lastAttemptId: 'a0000000-0000-4000-8000-000000000001' }));
    const summary = await screen.findByRole('region', { name: 'Attempt 2' });
    expect(within(summary).getByText('Attempt 2', { selector: 'p' })).toBeInTheDocument();
    expect(summary).not.toHaveTextContent(/voice/i);
  });

  it('summary_without_focus_has_no_focus_line', async () => {
    setViewportWidth(390);
    summaryApi();
    await openDrive('/drive', driving({ mode: 'finished', lastAttemptId: 'a0000000-0000-4000-8000-000000000001' }));
    const summary = await screen.findByRole('region', { name: 'Attempt 2' });
    expect(summary).not.toHaveTextContent('Focus for the next attempt');
  });

  it('summary_labels_the_time_from_the_game', async () => {
    setViewportWidth(1280);
    summaryApi();
    await openDrive('/drive', driving({ mode: 'finished', lastAttemptId: 'a0000000-0000-4000-8000-000000000001' }));
    const summary = await screen.findByRole('region', { name: 'Attempt 2' });
    expect(within(summary).getByText('Time from the game.')).toBeInTheDocument();
    expect(summary).not.toHaveTextContent('Measured from telemetry');
    expect(summary).not.toHaveTextContent('official');
    expect(within(summary).queryByRole('textbox')).not.toBeInTheDocument();
    expect(within(summary).queryByRole('button', { name: 'Save official time' })).not.toBeInTheDocument();
  });

  it('aborted_summary_names_the_reason_in_plain_words', async () => {
    setViewportWidth(390);
    driveApi()
      .on('GET /api/attempts/a0000000-0000-4000-8000-000000000001', { ...ATTEMPT, completion: 'aborted', reason: 'left-track', timeMs: null, gapToBestMs: null })
      .install();
    await openDrive('/drive', driving({ mode: 'finished', lastAttemptId: 'a0000000-0000-4000-8000-000000000001' }));
    const summary = await screen.findByRole('region', { name: 'Attempt 2' });
    expect(summary).toHaveTextContent('No time');
    expect(within(summary).getByText('The attempt did not finish (left the track). Only complete attempts have a time.')).toBeInTheDocument();
    expect(summary).not.toHaveTextContent('Gap to your best');
  });

  it('summary_never_shows_the_previous_attempt_while_the_next_loads', async () => {
    setViewportWidth(1280);
    summaryApi().on('GET /api/attempts/a0000000-0000-4000-8000-000000000002', () => new Promise(() => undefined));
    const { socket } = await openDrive('/drive', driving({ mode: 'finished', lastAttemptId: 'a0000000-0000-4000-8000-000000000001' }));
    await screen.findByRole('region', { name: 'Attempt 2' });
    send(socket, driving({ seq: 2, mode: 'finished', lastAttemptId: 'a0000000-0000-4000-8000-000000000002' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Attempt 2' })).not.toBeInTheDocument());
  });
});

function armed(overrides: Partial<LiveState> = {}): LiveState {
  return liveState({
    mode: 'armed',
    connection: 'connected',
    exerciseId: 'e0000000-0000-4000-8000-000000000001',
    referenceId: 'ref-demo',
    voiceDeviceId: voiceDeviceId(),
    voiceReady: true,
    speedMps: 0,
    ...overrides
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe('drive mode', () => {
  it('arm_panel_claims_voice_in_place', async () => {
    setViewportWidth(390);
    driveApi().install();
    const rig = playerRig();
    vi.spyOn(rig.player, 'preload').mockResolvedValue(undefined);
    const view = renderApp({ path: '/drive', player: rig.player });
    await screen.findByRole('heading', { name: 'Drive' });
    const socket = await waitFor(() => view.sockets.latest);
    act(() => {
      socket.open();
      socket.receive({ type: 'state', state: liveState({ voiceDeviceId: null }) });
    });
    expect(screen.getByRole('heading', { name: 'The voice is off' })).toBeInTheDocument();
    expect(screen.getByText('This device can play the cues. A phone must stay unlocked during the attempt.')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Use this device for voice' }));
    await waitFor(() => expect(socket.sent).toContainEqual({ type: 'claim-voice', deviceId: voiceDeviceId(), ready: true }));
    act(() => socket.receive({ type: 'state', state: liveState({ seq: 2, voiceDeviceId: voiceDeviceId(), voiceReady: true }) }));
    expect(await screen.findByText('This device plays the voice')).toBeInTheDocument();
    expect(await screen.findByText(/3 cues loaded\./)).toBeInTheDocument();
    const test = screen.getByRole('button', { name: 'Test' });
    expect(test.textContent).toBe('');
    expect(test.querySelector('[data-icon="speaker"]')).not.toBeNull();
    expect(screen.queryByRole('heading', { name: 'The voice is off' })).not.toBeInTheDocument();
  });

  it('drive_mode_hides_navigation_when_armed', async () => {
    setViewportWidth(390);
    driveApi().install();
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument();
    const view = renderApp({ path: '/drive' });
    expect(await screen.findByRole('navigation', { name: 'Main' })).toBeInTheDocument();
    const socket = await waitFor(() => view.sockets.latest);
    act(() => {
      socket.open();
      socket.receive({ type: 'state', state: armed() });
    });
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument();
    expect(screen.queryByRole('banner')).not.toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Current cue' })).toHaveTextContent('READY');
    expect(screen.getByText('Waiting for the start')).toBeInTheDocument();
    expect(await screen.findByText('First cue: Hard brake. Eighty five')).toBeInTheDocument();
    expect(screen.getByText('after the start')).toBeInTheDocument();
  });

  it('drive_header_shows_the_attempt_number_of_the_exercise', async () => {
    setViewportWidth(1280);
    driveApi().install();
    const { socket } = await openDrive('/drive', driving({ attemptNumber: 4 }));
    expect(screen.getByText('Attempt 4 · Yangwang Experience / Racing Lines')).toBeInTheDocument();
    send(socket, driving({ attemptNumber: 5 }));
    expect(screen.getByText('Attempt 5 · Yangwang Experience / Racing Lines')).toBeInTheDocument();
  });

  it('drive_header_says_ready_before_the_start', async () => {
    setViewportWidth(1280);
    driveApi().install();
    await openDrive('/drive', driving({ mode: 'armed', attemptNumber: null, sM: null, speedMps: null }));
    expect(screen.getByText('Ready · Yangwang Experience / Racing Lines')).toBeInTheDocument();
  });

  it('drive_mode_has_no_start_finish_or_abort_buttons', async () => {
    setViewportWidth(1280);
    driveApi().install();
    await openDrive('/drive', driving({ lastCue: cue({ id: 'c1', eventKey: 'brake@332', kind: 'hard-brake', targetSpeedKph: 85, clip: 'hard-brake' }) }));
    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();
    for (const name of ['Start now', 'Finish now', 'Abort attempt']) expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    expect(screen.getByText('Attempt 2 · Yangwang Experience / Racing Lines')).toBeInTheDocument();
    expect(await screen.findByText('Cue 1 of 3 · before T1')).toBeInTheDocument();
    expect(screen.getByText('m of 20')).toBeInTheDocument();
  });

  it('missed_start_prompt_shows_when_the_server_detects_a_missed_start', async () => {
    setViewportWidth(390);
    driveApi().install();
    const { socket } = await openDrive('/drive', armed({ speedMps: 40 / KPH_PER_MPS }));
    expect(screen.queryByRole('alert', { name: 'The attempt did not start' })).not.toBeInTheDocument();
    send(socket, armed({ seq: 2, speedMps: 42 / KPH_PER_MPS, startMissed: true }));
    const prompt = screen.getByRole('alert', { name: 'The attempt did not start' });
    expect(prompt).toHaveTextContent('The exercise was already running when you pressed Start. Restart the exercise in the game.');
    expect(within(prompt).getAllByRole('button').map(button => button.textContent)).toEqual(['OK']);
  });

  it('missed_start_prompt_hides_when_the_server_clears_it', () => {
    const { result, rerender } = renderHook(({ state }) => useMissedStart(state), { initialProps: { state: armed({ startMissed: true }) } });
    expect(result.current.missed).toBe(true);
    rerender({ state: armed({ seq: 2, startMissed: false }) });
    expect(result.current.missed).toBe(false);
    rerender({ state: armed({ seq: 3, startMissed: true }) });
    expect(result.current.missed).toBe(true);
  });

  it('ok_closes_the_missed_start_prompt', async () => {
    setViewportWidth(390);
    driveApi().install();
    await openDrive('/drive', armed({ startMissed: true }));
    const prompt = screen.getByRole('alert', { name: 'The attempt did not start' });
    await userEvent.setup().click(within(prompt).getByRole('button', { name: 'OK' }));
    expect(screen.queryByRole('alert', { name: 'The attempt did not start' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start now' })).not.toBeInTheDocument();
  });

  it('missed_start_prompt_hidden_when_driving_starts', () => {
    const { result, rerender } = renderHook(({ state }) => useMissedStart(state), { initialProps: { state: armed({ startMissed: true }) } });
    expect(result.current.missed).toBe(true);
    rerender({ state: driving({ seq: 2 }) });
    expect(result.current.missed).toBe(false);
  });

  it('dismissed_prompt_stays_hidden_until_the_mode_changes', () => {
    const { result, rerender } = renderHook(({ state }) => useMissedStart(state), { initialProps: { state: armed({ startMissed: true }) } });
    act(() => result.current.dismiss());
    expect(result.current.missed).toBe(false);
    rerender({ state: armed({ seq: 2, startMissed: false }) });
    rerender({ state: armed({ seq: 3, startMissed: true }) });
    expect(result.current.missed).toBe(false);
    rerender({ state: driving({ seq: 4 }) });
    rerender({ state: armed({ seq: 5, mode: 'finished', startMissed: true }) });
    expect(result.current.missed).toBe(true);
  });

  it('finished_attempt_shows_summary_in_drive_mode', async () => {
    setViewportWidth(390);
    driveApi().on('GET /api/attempts/a0000000-0000-4000-8000-000000000001', ATTEMPT).install();
    await openDrive('/drive', driving({ mode: 'finished', lastAttemptId: 'a0000000-0000-4000-8000-000000000001' }));
    const summary = await screen.findByRole('region', { name: 'Attempt 2' });
    expect(summary.closest('.drive-stage')).not.toBeNull();
    expect(within(summary).getByRole('button', { name: 'Drive again' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument();
  });

  it('finished_summary_waits_for_the_new_attempt', async () => {
    setViewportWidth(390);
    driveApi()
      .on('GET /api/attempts/a0000000-0000-4000-8000-000000000001', ATTEMPT)
      .on('GET /api/attempts/a0000000-0000-4000-8000-000000000002', { ...ATTEMPT, id: 'a0000000-0000-4000-8000-000000000002', number: 3 })
      .install();
    const { socket } = await openDrive('/drive', armed({ lastAttemptId: 'a0000000-0000-4000-8000-000000000001' }));
    send(socket, driving({ seq: 2, lastAttemptId: 'a0000000-0000-4000-8000-000000000001' }));
    send(socket, driving({ seq: 3, mode: 'finished', lastAttemptId: 'a0000000-0000-4000-8000-000000000001' }));
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 20));
    });
    expect(screen.queryByRole('region', { name: 'Attempt 2' })).not.toBeInTheDocument();
    send(socket, driving({ seq: 4, mode: 'finished', lastAttemptId: 'a0000000-0000-4000-8000-000000000002' }));
    expect(await screen.findByRole('region', { name: 'Attempt 3' })).toBeInTheDocument();
  });

  it('stop_brings_back_the_navigation', async () => {
    setViewportWidth(390);
    const api = driveApi().install();
    const { socket } = await openDrive('/drive', armed());
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Stop' }));
    await waitFor(() => expect(api.called('POST /api/training/disarm')).toBe(true));
    send(socket, liveState({ seq: 2, connection: 'connected', voiceDeviceId: voiceDeviceId(), voiceReady: true }));
    expect(await screen.findByRole('navigation', { name: 'Main' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start an attempt' })).toBeInTheDocument();
  });

  it('drive_shows_gap_to_reference', async () => {
    setViewportWidth(390);
    driveApi().install();
    const { socket } = await openDrive('/drive', driving({ gapMs: 400 }));
    expect(screen.getByText('+0.4')).toBeInTheDocument();
    expect(screen.getByText('s to reference')).toBeInTheDocument();
    send(socket, driving({ seq: 2, gapMs: -250 }));
    expect(screen.getByText('\u22120.3')).toBeInTheDocument();
    send(socket, driving({ seq: 3, gapMs: null }));
    expect(screen.queryByText('+0.4')).not.toBeInTheDocument();
    expect(screen.queryByText('\u22120.3')).not.toBeInTheDocument();
  });
});
