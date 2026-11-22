import { act, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { KPH_PER_MPS, type AttemptSummary, type LiveState } from '@gt7/contracts';
import { useMissedStart } from '../src/features/drive/missed-start.ts';
import { voiceDeviceId } from '../src/voice/device.ts';
import type { VoicePlayer } from '../src/voice/VoicePlayer.ts';
import { exercise, exerciseApi, REFERENCE_CLIPS, rememberExercise, EXERCISE_ID } from './fixtures.ts';
import { cue, liveState, playerRig, renderApp, setViewportWidth, USER, type ApiStub, type FakeSocket, openLive, maybeEl, findEl, maybeSection, el, els, findSummary, maybeIconButton } from './support.tsx';
import { ATTEMPT_ID } from './review-fixtures.ts';

const ARMED_CLIPS = REFERENCE_CLIPS;

const DRIVE_PATH = `/exercises/${EXERCISE_ID}/drive`;

const ARMED = { captureId: 'cap-9', exerciseId: EXERCISE_ID, referenceId: 'ref-demo' };

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
    exerciseId: EXERCISE_ID,
    attemptNumber: 2,
    sM: 300,
    speedMps: 142 / KPH_PER_MPS,
    referenceId: 'ref-demo',
    ...overrides
  });
}

async function openDrive(path = DRIVE_PATH, state: LiveState = armed(), player?: VoicePlayer) {
  const view = renderApp({ path, ...(player ? { player } : {}) });
  await findEl('nav.nav');
  return { ...view, socket: await openLive(view.sockets, state) };
}

function send(socket: FakeSocket, state: LiveState) {
  act(() => socket.receive({ type: 'state', state }));
}

describe('drive', () => {
  it('drive_shows_one_cue_and_next_cue', async () => {
    setViewportWidth(390);
    driveApi().install();
    await openDrive(DRIVE_PATH, driving({ lastCue: cue({ kind: 'brake', targetSpeedKph: 85 }), nextCue: { clip: 'full-throttle', inM: 120 } }));
    const current = el('[role="status"].cue');
    expect(current).toHaveTextContent('Brake85');
    expect(els('[role="status"].cue')).toHaveLength(1);
    expect(screen.getByText('Next: Full throttle, in 120 m')).toHaveClass('race-lead');
    expect(document.querySelector('.next-bar')).toBeNull();
    expect(screen.getByText('142')).toBeInTheDocument();
  });

  it('drive_shows_the_live_speed_in_kmh', async () => {
    setViewportWidth(390);
    driveApi().install();
    await openDrive(DRIVE_PATH, driving({ speedMps: 141.6 / KPH_PER_MPS }));
    expect(screen.getByText('142')).toBeInTheDocument();
  });

  it('drive_is_dark_in_light_theme', async () => {
    setViewportWidth(390);
    document.documentElement.dataset.theme = 'light';
    driveApi().install();
    await openDrive(DRIVE_PATH, driving());
    expect(document.querySelector('.drive-stage')).toHaveAttribute('data-surface', 'night');
  });

  it('ready_voice_shows_nothing_on_drive', async () => {
    driveApi().install();
    const rig = playerRig();
    await rig.player.unlock();
    vi.spyOn(rig.player, 'preload').mockResolvedValue(undefined);
    await openDrive(DRIVE_PATH, armed({ voiceDeviceId: voiceDeviceId(), voiceReady: true }), rig.player);
    await screen.findByRole('button', { name: 'Stop training' });
    await act(async () => undefined);
    expect(screen.queryByText(/No device plays the voice/)).toBeNull();
    expect(screen.queryByText(/cues loaded/)).toBeNull();
    expect(maybeIconButton('Test')).toBeNull();
    expect(maybeEl('.stage-voice')).toBeNull();
  });

  it('voice_on_another_device_shows_nothing_on_drive', async () => {
    driveApi().install();
    await openDrive(DRIVE_PATH, armed({ voiceDeviceId: 'phone', voiceReady: true }));
    await screen.findByRole('button', { name: 'Stop training' });
    expect(screen.queryByRole('heading', { name: 'The voice is on another device' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Use this device for voice' })).toBeNull();
    expect(maybeEl('.stage-voice')).toBeNull();
  });

  it('no_voice_shows_one_notice_with_one_button', async () => {
    setViewportWidth(390);
    driveApi().install();
    const rig = playerRig();
    vi.spyOn(rig.player, 'preload').mockResolvedValue(undefined);
    const view = await openDrive(DRIVE_PATH, armed({ voiceDeviceId: null }), rig.player);
    const socket = view.socket;
    const notice = await findEl('.stage-voice');
    expect(notice).toHaveTextContent(/^No device plays the voice\.Use this device for voice$/);
    expect(notice).toHaveClass('stage-voice');
    expect(notice.closest('.drive-stage')).not.toBeNull();
    expect(within(notice).queryByRole('heading')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'The voice is off' })).toBeNull();
    expect(screen.queryByText(/A phone must stay unlocked/)).toBeNull();
    expect(within(notice).getAllByRole('button')).toHaveLength(1);
    await userEvent.setup().click(within(notice).getByRole('button', { name: 'Use this device for voice' }));
    await waitFor(() => expect(socket.sent).toContainEqual({ type: 'claim-voice', deviceId: voiceDeviceId(), ready: true }));
    act(() => socket.receive({ type: 'state', state: armed({ seq: 2, voiceDeviceId: voiceDeviceId(), voiceReady: true }) }));
    await waitFor(() => expect(maybeEl('.stage-voice')).toBeNull());
  });

  it('sound_not_started_shows_the_notice', async () => {
    driveApi().install();
    await openDrive(DRIVE_PATH, armed({ voiceDeviceId: voiceDeviceId(), voiceReady: false }));
    const notice = await findEl('.stage-voice');
    expect(notice).toHaveTextContent('No device plays the voice.');
    expect(within(notice).getByRole('button', { name: 'Use this device for voice' })).toBeEnabled();
  });

  it('failed_claim_shows_the_error_in_the_notice', async () => {
    driveApi().install();
    const rig = playerRig();
    vi.spyOn(rig.player, 'preload').mockRejectedValue(new Error('HTTP 500'));
    await openDrive(DRIVE_PATH, armed({ voiceDeviceId: null }), rig.player);
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Use this device for voice' }));
    expect(await within(el('.stage-voice')).findByRole('alert')).toHaveTextContent('HTTP 500');
  });
  it('clip_failure_alert_goes_when_the_voice_moves_to_another_device', async () => {
    const api = driveApi().install();
    const rig = playerRig();
    await rig.player.unlock();
    vi.spyOn(rig.player, 'preload').mockRejectedValue(new Error('The voice clips did not load. Reload the page.'));
    const view = renderApp({ path: `/exercises/${EXERCISE_ID}/attempts`, player: rig.player });
    await openLive(view.sockets, liveState({ voiceDeviceId: voiceDeviceId(), voiceReady: true }));
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Drive' }));
    await waitFor(() => expect(api.called('POST /api/training/arm')).toBe(true));
    const armed = { seq: 2, mode: 'armed' as const, exerciseId: EXERCISE_ID, referenceId: 'ref-demo', voiceReady: true };
    act(() => view.sockets.latest.receive({ type: 'state', state: liveState({ ...armed, voiceDeviceId: voiceDeviceId() }) }));
    expect(await screen.findByText('The voice clips did not load. Reload the page.')).toBeInTheDocument();
    act(() => view.sockets.latest.receive({ type: 'state', state: liveState({ ...armed, seq: 3, voiceDeviceId: 'phone' }) }));
    expect(screen.getByRole('button', { name: 'Stop training' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
    expect(screen.queryByText('The voice clips did not load. Reload the page.')).not.toBeInTheDocument();
  });

  it('connection_lost_clears_cue_and_says_so', async () => {
    setViewportWidth(390);
    driveApi().install();
    const { socket } = await openDrive(DRIVE_PATH, driving({ lastCue: cue() }));
    expect(el('[role="status"].cue')).toHaveTextContent('Brake');
    send(socket, driving({ seq: 2, connection: 'disconnected', lastCue: cue() }));
    expect(el('[role="status"].cue')).not.toHaveTextContent('Brake');
    expect(screen.getByText(/No packets from the console/)).toBeInTheDocument();
    expect(screen.queryByText('142')).not.toBeInTheDocument();
    act(() => socket.close(1006));
    expect(screen.getByText(/Connection to GT7 Tutor lost/)).toBeInTheDocument();
  });

  it('paused_and_guidance_suspended_states_have_text', async () => {
    setViewportWidth(390);
    driveApi().install();
    const { socket } = await openDrive(DRIVE_PATH, driving({ mode: 'paused' }));
    expect(screen.getByText(/Paused\. Cues stop until you continue/)).toBeInTheDocument();
    send(socket, driving({ seq: 2, guidance: { mode: 'suspended', reason: 'untrusted-position' } }));
    expect(screen.getByText(/too far from the reference line/)).toBeInTheDocument();
    send(socket, driving({ seq: 3, guidance: { mode: 'waiting-for-restart', reason: 'awaiting-restart' } }));
    expect(screen.getByText(/Restart the attempt to get cues again/)).toBeInTheDocument();
  });

  it('drive_view_shows_the_exercise_of_the_route_not_the_remembered_one', async () => {
    setViewportWidth(390);
    const basics = exercise({ id: 'e0000000-0000-4000-8000-000000000002', name: 'Cornering Basics 1', activeReferenceId: null, step: 1 });
    driveApi().on(`GET /api/exercises/${basics.id}`, basics).install();
    rememberExercise(basics.id);
    const { socket } = await openDrive(DRIVE_PATH, driving({ lastCue: cue({ kind: 'brake', targetSpeedKph: 85 }) }));
    expect(await screen.findByText('142')).toBeInTheDocument();
    expect(el('[role="status"].cue')).toHaveTextContent('Brake85');
    expect(screen.getByText(/· Yangwang Experience \/ Racing Lines$/)).toBeInTheDocument();
  });

  it('drive_route_without_a_training_opens_the_attempts', async () => {
    driveApi().install();
    window.history.replaceState(null, '', '/');
    window.history.pushState(null, '', '/');
    const before = window.history.length;
    await openDrive(DRIVE_PATH, liveState({ connection: 'connected' }));
    await waitFor(() => expect(window.location.pathname).toBe(`/exercises/${EXERCISE_ID}/attempts`));
    expect(window.history.length).toBe(before);
    expect(screen.queryByRole('heading', { name: 'Drive' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Start an attempt' })).toBeNull();
  });

  it('drive_route_without_a_reference_opens_the_attempts', async () => {
    const basics = exercise({ id: 'e0000000-0000-4000-8000-000000000002', name: 'Cornering Basics 1', activeReferenceId: null, step: 1 });
    driveApi().on(`GET /api/exercises/${basics.id}`, basics).install();
    await openDrive(`/exercises/${basics.id}/drive`, liveState());
    await waitFor(() => expect(window.location.pathname).toBe(`/exercises/${basics.id}/attempts`));
    expect(await screen.findByText('Record the reference first.')).toBeInTheDocument();
  });

  it('drive_route_of_another_exercise_opens_its_attempts', async () => {
    const other = exercise({ id: 'e0000000-0000-4000-8000-000000000002', name: 'Cornering Basics 1', activeReferenceId: 'ref-demo', step: 2 });
    const api = driveApi().on('GET /api/exercises', [exercise({ step: 3 }), other]).on(`GET /api/exercises/${other.id}`, other).install();
    await openDrive(`/exercises/${other.id}/drive`, armed());
    await waitFor(() => expect(window.location.pathname).toBe(`/exercises/${other.id}/attempts`));
    expect(maybeEl('[role="status"].cue')).toBeNull();
    expect(api.called('POST /api/training/disarm')).toBe(false);
  });

  it('drive_of_an_unknown_exercise_says_it_is_missing', async () => {
    driveApi().on('GET /api/exercises/e0000000-0000-4000-8000-00000000000f', { status: 404, body: { code: 'not-found' } }).install();
    renderApp({ path: '/exercises/e0000000-0000-4000-8000-00000000000f/drive' });
    expect(await screen.findByRole('heading', { level: 1, name: 'This exercise is not here' })).toBeInTheDocument();
    expect(window.localStorage.getItem(`gt7.currentExercise.${USER.id}`)).not.toBe('e0000000-0000-4000-8000-00000000000f');
  });

  it('voice_device_loads_clips_when_training_is_armed_elsewhere', async () => {
    driveApi().install();
    const rig = playerRig();
    const preload = vi.spyOn(rig.player, 'preload').mockResolvedValue(undefined);
    const view = renderApp({ path: '/setup', player: rig.player });
    await screen.findByRole('heading', { name: 'Setup' });
    await openLive(view.sockets, liveState({ voiceDeviceId: voiceDeviceId(), voiceReady: true }));
    expect(preload).not.toHaveBeenCalled();
    act(() =>
      view.sockets.latest.receive({
        type: 'state',
        state: liveState({ seq: 2, mode: 'armed', exerciseId: EXERCISE_ID, referenceId: 'ref-demo', voiceDeviceId: voiceDeviceId(), voiceReady: true })
      })
    );
    await waitFor(() => expect(preload).toHaveBeenCalledWith(ARMED_CLIPS));
  });

  it('voice_player_preloads_the_reference_clips', async () => {
    const api = driveApi().on('GET /api/references/ref-demo/clips', ['hard-brake', 'speed-85', 'voice-check']).install();
    const rig = playerRig();
    const view = renderApp({ path: '/setup', player: rig.player });
    await screen.findByRole('heading', { name: 'Setup' });
    await openLive(view.sockets, liveState({ mode: 'armed', exerciseId: EXERCISE_ID, referenceId: 'ref-demo', voiceDeviceId: voiceDeviceId(), voiceReady: true }));
    await waitFor(() => expect(['hard-brake', 'speed-85', 'voice-check'].every(clip => rig.player.hasClip(clip))).toBe(true));
    expect(api.called('GET /api/references/ref-demo/clips')).toBe(true);
    expect(api.called('GET /api/references/ref-demo/cues')).toBe(false);
  });

  it('every_attempt_shows_the_next_cue_without_a_voice_device', async () => {
    setViewportWidth(390);
    driveApi().install();
    await openDrive(DRIVE_PATH, driving({ voiceDeviceId: null, lastCue: null, nextCue: { clip: 'brake', inM: 50 } }));
    expect(screen.getByText('Next: Brake, in 50 m')).toBeInTheDocument();
    expect(screen.queryByText('No voice')).not.toBeInTheDocument();
  });
});

const ATTEMPT: AttemptSummary = {
  id: ATTEMPT_ID,
  exerciseId: EXERCISE_ID,
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
    const { socket } = await openDrive(DRIVE_PATH, driving({ lastCue: cue({ id: 'c1', kind: 'hard-brake', targetSpeedKph: 85, clip: 'hard-brake' }) }));
    const current = () => el('[role="status"].cue');
    expect(current()).toHaveTextContent('Hard brake85');
    send(socket, driving({ seq: 2, lastCue: cue({ id: 'c2', kind: 'full-throttle', targetSpeedKph: 95, clip: 'full-throttle' }) }));
    expect(current()).toHaveTextContent('Full throttle95');
    send(socket, driving({ seq: 3, lastCue: cue({ id: 'c3', kind: 'tighter', targetSpeedKph: null, clip: 'tighter' }) }));
    expect(current()).toHaveTextContent(/^Closer to apex$/);
    send(socket, driving({ seq: 4, lastCue: cue({ id: 'c4', kind: 'big-stop', targetSpeedKph: null, clip: 'big-stop' }) }));
    expect(current()).toHaveTextContent(/^Big brake ahead$/);
    send(socket, driving({ seq: 5, lastCue: cue({ id: 'c5', kind: 'light-brake', targetSpeedKph: 120, clip: 'light-brake' }) }));
    expect(current()).toHaveTextContent('Light brake120');
  });

  it('drive_does_not_show_the_focus_cue', async () => {
    setViewportWidth(390);
    driveApi().install();
    await openDrive(DRIVE_PATH, driving({ lastCue: cue({ id: 'f1', kind: 'focus', eventKey: 'focus', targetSpeedKph: null, clip: 'focus-brake-early-1' }) }));
    const current = el('[role="status"].cue');
    expect(current).toHaveTextContent(/^$/);
    expect(current).toHaveClass('idle');
  });
});

describe('attempt summary', () => {
  function summaryApi(): ApiStub {
    return driveApi().on(`GET /api/attempts/${ATTEMPT_ID}`, ATTEMPT).install();
  }

  it('summary_appears_on_finished_with_time_gap_and_largest_difference', async () => {
    setViewportWidth(390);
    summaryApi();
    await openDrive(DRIVE_PATH, driving({ mode: 'finished', lastAttemptId: ATTEMPT_ID }));
    const summary = await findSummary(2);
    expect(summary).toHaveTextContent('0:27.100');
    expect(summary).toHaveTextContent('+0.35 s');
    expect(summary).toHaveTextContent('332 m. Braked 14 m earlier');
    expect(screen.getByRole('link', { name: 'Review this attempt' })).toHaveAttribute('href', `/attempts/${ATTEMPT_ID}/review`);
  });

  it('summary_shows_the_focus_sentence', async () => {
    setViewportWidth(390);
    driveApi()
      .on(`GET /api/attempts/${ATTEMPT_ID}`, { ...ATTEMPT, focus: { kind: 'brake-early', turn: 1, clip: 'focus-brake-early-1' } })
      .install();
    await openDrive(DRIVE_PATH, driving({ mode: 'finished', lastAttemptId: ATTEMPT_ID }));
    const summary = await findSummary(2);
    expect(within(summary).getByText('Turn one. Brake later.')).toBeInTheDocument();
    expect(summary).toHaveTextContent('Focus for the next attempt');
    expect(within(summary).queryByText('A difference from the reference.')).toBeNull();
    expect(within(summary).queryByText(/mistake/i)).toBeNull();
  });

  it('summary_title_is_the_attempt_number_without_voice_text', async () => {
    summaryApi();
    await openDrive(DRIVE_PATH, driving({ mode: 'finished', lastAttemptId: ATTEMPT_ID }));
    const summary = await findSummary(2);
    expect(within(summary).getByText('Attempt 2', { selector: 'p' })).toBeInTheDocument();
    expect(summary).not.toHaveTextContent(/voice/i);
  });

  it('summary_without_focus_has_no_focus_line', async () => {
    setViewportWidth(390);
    summaryApi();
    await openDrive(DRIVE_PATH, driving({ mode: 'finished', lastAttemptId: ATTEMPT_ID }));
    const summary = await findSummary(2);
    expect(summary).not.toHaveTextContent('Focus for the next attempt');
  });

  it('summary_labels_the_time_from_the_game', async () => {
    summaryApi();
    await openDrive(DRIVE_PATH, driving({ mode: 'finished', lastAttemptId: ATTEMPT_ID }));
    const summary = await findSummary(2);
    expect(within(summary).getByText('Time from the game.')).toBeInTheDocument();
    expect(summary).not.toHaveTextContent('Measured from telemetry');
    expect(summary).not.toHaveTextContent('official');
    expect(within(summary).queryByRole('textbox')).not.toBeInTheDocument();
    expect(within(summary).queryByRole('button', { name: 'Save official time' })).not.toBeInTheDocument();
  });

  it('aborted_summary_names_the_reason_in_plain_words', async () => {
    setViewportWidth(390);
    driveApi()
      .on(`GET /api/attempts/${ATTEMPT_ID}`, { ...ATTEMPT, completion: 'aborted', reason: 'left-track', timeMs: null, gapToBestMs: null })
      .install();
    await openDrive(DRIVE_PATH, driving({ mode: 'finished', lastAttemptId: ATTEMPT_ID }));
    const summary = await findSummary(2);
    expect(summary).toHaveTextContent('No time');
    expect(within(summary).getByText('The attempt did not finish (left the track). Only complete attempts have a time.')).toBeInTheDocument();
    expect(summary).not.toHaveTextContent('Gap to your best');
  });

  it('summary_never_shows_the_previous_attempt_while_the_next_loads', async () => {
    summaryApi().on('GET /api/attempts/a0000000-0000-4000-8000-000000000002', () => new Promise(() => undefined));
    const { socket } = await openDrive(DRIVE_PATH, driving({ mode: 'finished', lastAttemptId: ATTEMPT_ID }));
    await findSummary(2);
    send(socket, driving({ seq: 2, mode: 'finished', lastAttemptId: 'a0000000-0000-4000-8000-000000000002' }));
    await waitFor(() => expect(maybeSection('Attempt 2')).not.toBeInTheDocument());
  });
});

function armed(overrides: Partial<LiveState> = {}): LiveState {
  return liveState({
    mode: 'armed',
    connection: 'connected',
    exerciseId: EXERCISE_ID,
    referenceId: 'ref-demo',
    voiceDeviceId: voiceDeviceId(),
    voiceReady: true,
    speedMps: 0,
    ...overrides
  });
}

describe('drive mode', () => {
  it('drive_mode_hides_navigation_when_armed', async () => {
    setViewportWidth(390);
    driveApi().install();
    expect(maybeEl('nav.nav')).not.toBeInTheDocument();
    const view = renderApp({ path: DRIVE_PATH });
    expect(await findEl('nav.nav')).toBeInTheDocument();
    const socket = await openLive(view.sockets, armed());
    expect(maybeEl('nav.nav')).not.toBeInTheDocument();
    expect(screen.queryByRole('banner')).not.toBeInTheDocument();
    expect(el('[role="status"].cue')).toHaveTextContent('READY');
    expect(screen.queryByText('Waiting for the start')).toBeNull();
    expect(await screen.findByText('GT7 Tutor finds the start and the finish. You can look at the TV now. First cue after the start: Hard brake. Eighty five.')).toHaveClass('race-note');
  });

  it('drive_header_shows_the_attempt_number_of_the_exercise', async () => {
    driveApi().install();
    const { socket } = await openDrive(DRIVE_PATH, driving({ attemptNumber: 4 }));
    expect(screen.getByText('Attempt 4 · Yangwang Experience / Racing Lines')).toBeInTheDocument();
    send(socket, driving({ attemptNumber: 5 }));
    expect(screen.getByText('Attempt 5 · Yangwang Experience / Racing Lines')).toBeInTheDocument();
  });

  it('drive_header_names_only_the_exercise_before_the_start', async () => {
    driveApi().install();
    await openDrive(DRIVE_PATH, driving({ mode: 'armed', attemptNumber: null, sM: null, speedMps: null }));
    const sub = document.querySelector('.stage-top .race-status-sub');
    expect(sub).toHaveTextContent(/^Yangwang Experience \/ Racing Lines$/);
    const status = document.querySelector('.stage-top .race-status-word')!;
    expect([...status.querySelectorAll('.race-dot')].map(dot => dot.className)).toEqual(['race-dot green', 'race-dot red']);
    expect(status).toHaveTextContent(/^TelemetryVoice$/);
  });

  it('ready_leaves_out_the_first_cue_while_no_packets_arrive', async () => {
    driveApi().install();
    await openDrive(DRIVE_PATH, armed({ connection: 'stale' }));
    expect(await screen.findByText('GT7 Tutor finds the start and the finish. You can look at the TV now.')).toHaveClass('race-note');
    expect(screen.queryByText(/First cue after the start/)).toBeNull();
  });

  it('cue_reserves_two_lines_only_while_an_attempt_runs', async () => {
    driveApi().install();
    const { socket } = await openDrive(DRIVE_PATH, armed());
    expect(el('[role="status"].cue')).not.toHaveClass('running');
    send(socket, driving({ seq: 2 }));
    expect(el('[role="status"].cue')).toHaveClass('running');
  });

  it('live_values_use_the_race_values', async () => {
    driveApi().install();
    await openDrive(DRIVE_PATH, driving({ gapMs: 400 }));
    await screen.findByText('m of 20');
    const stats = [...document.querySelectorAll('.live-numbers .race-stat')].map(stat => [stat.querySelector('b')!.textContent, stat.querySelector('span')!.textContent]);
    expect(stats).toEqual([['142', 'km/h'], ['300', 'm of 20'], ['+0.4', 's to reference']]);
    expect(document.querySelector('.live-numbers')).toHaveClass('race-stats');
  });

  it('drive_mode_has_no_start_finish_or_abort_buttons', async () => {
    driveApi().install();
    await openDrive(DRIVE_PATH, driving({ lastCue: cue({ id: 'c1', eventKey: 'brake@332', kind: 'hard-brake', targetSpeedKph: 85, clip: 'hard-brake' }) }));
    expect(screen.getByRole('button', { name: 'Stop training' })).toBeInTheDocument();
    for (const name of ['Start now', 'Finish now', 'Abort attempt']) expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    expect(screen.getByText('Attempt 2 · Yangwang Experience / Racing Lines')).toBeInTheDocument();
    expect(await screen.findByText('Cue 1 of 3 · before T1')).toBeInTheDocument();
    expect(screen.getByText('m of 20')).toBeInTheDocument();
  });

  it('missed_start_prompt_shows_when_the_server_detects_a_missed_start', async () => {
    setViewportWidth(390);
    driveApi().install();
    const { socket } = await openDrive(DRIVE_PATH, armed({ speedMps: 40 / KPH_PER_MPS }));
    expect(maybeEl('.missed-start')).not.toBeInTheDocument();
    send(socket, armed({ seq: 2, speedMps: 42 / KPH_PER_MPS, startMissed: true }));
    const prompt = el('.missed-start');
    expect(prompt).toHaveTextContent('The exercise was already running when you selected Drive. Restart the exercise in the game.');
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
    await openDrive(DRIVE_PATH, armed({ startMissed: true }));
    const prompt = el('.missed-start');
    await userEvent.setup().click(within(prompt).getByRole('button', { name: 'OK' }));
    expect(maybeEl('.missed-start')).not.toBeInTheDocument();
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
    driveApi().on(`GET /api/attempts/${ATTEMPT_ID}`, ATTEMPT).install();
    await openDrive(DRIVE_PATH, driving({ mode: 'finished', lastAttemptId: ATTEMPT_ID }));
    const summary = await findSummary(2);
    expect(summary.closest('.drive-stage')).not.toBeNull();
    expect(within(summary).getByRole('button', { name: 'Drive again' })).toBeInTheDocument();
    expect(maybeEl('nav.nav')).not.toBeInTheDocument();
  });

  it('finished_summary_waits_for_the_new_attempt', async () => {
    setViewportWidth(390);
    driveApi()
      .on(`GET /api/attempts/${ATTEMPT_ID}`, ATTEMPT)
      .on('GET /api/attempts/a0000000-0000-4000-8000-000000000002', { ...ATTEMPT, id: 'a0000000-0000-4000-8000-000000000002', number: 3 })
      .install();
    const { socket } = await openDrive(DRIVE_PATH, armed({ lastAttemptId: ATTEMPT_ID }));
    send(socket, driving({ seq: 2, lastAttemptId: ATTEMPT_ID }));
    send(socket, driving({ seq: 3, mode: 'finished', lastAttemptId: ATTEMPT_ID }));
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 20));
    });
    expect(maybeSection('Attempt 2')).not.toBeInTheDocument();
    send(socket, driving({ seq: 4, mode: 'finished', lastAttemptId: 'a0000000-0000-4000-8000-000000000002' }));
    expect(await findSummary(3)).toBeInTheDocument();
  });

  it('stop_brings_back_the_navigation', async () => {
    setViewportWidth(390);
    const api = driveApi().install();
    const { socket } = await openDrive(DRIVE_PATH, armed());
    expect(maybeEl('nav.nav')).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Stop training' }));
    await waitFor(() => expect(api.called('POST /api/training/disarm')).toBe(true));
    send(socket, liveState({ seq: 2, connection: 'connected', voiceDeviceId: voiceDeviceId(), voiceReady: true }));
    expect(await findEl('nav.nav')).toBeInTheDocument();
    await waitFor(() => expect(window.location.pathname).toBe(`/exercises/${EXERCISE_ID}/attempts`));
    expect(await screen.findByRole('button', { name: 'Drive' })).toBeInTheDocument();
  });

  it('stop_training_opens_the_attempts_before_the_state_changes', async () => {
    const api = driveApi().install();
    await openDrive(DRIVE_PATH, armed());
    await userEvent.setup().click(screen.getByRole('button', { name: 'Stop training' }));
    await waitFor(() => expect(window.location.pathname).toBe(`/exercises/${EXERCISE_ID}/attempts`));
    expect(api.called('POST /api/training/disarm')).toBe(true);
  });

  it('ready_shows_the_help_text_and_hides_it_while_driving', async () => {
    driveApi().install();
    const { socket } = await openDrive(DRIVE_PATH, armed());
    const help = 'Open the exercise in GT7 and drive.';
    expect(await screen.findByText(help)).toHaveClass('race-lead');
    expect(screen.getByText(help).closest('.drive-stage')).not.toBeNull();
    send(socket, driving({ seq: 2 }));
    expect(screen.queryByText(help)).toBeNull();
  });

  it('drive_shows_gap_to_reference', async () => {
    setViewportWidth(390);
    driveApi().install();
    const { socket } = await openDrive(DRIVE_PATH, driving({ gapMs: 400 }));
    expect(screen.getByText('+0.4')).toBeInTheDocument();
    expect(screen.getByText('s to reference')).toBeInTheDocument();
    send(socket, driving({ seq: 2, gapMs: -250 }));
    expect(screen.getByText('\u22120.3')).toBeInTheDocument();
    send(socket, driving({ seq: 3, gapMs: null }));
    expect(screen.queryByText('+0.4')).not.toBeInTheDocument();
    expect(screen.queryByText('\u22120.3')).not.toBeInTheDocument();
  });
});
