import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { AttemptSummary, LiveState } from '@gt7/contracts';
import { voiceDeviceId } from '../src/voice/device.ts';
import { exercise, exerciseApi, rememberExercise } from './fixtures.ts';
import { cue, liveState, playerRig, renderApp, setViewportWidth, type ApiStub, type FakeSocket } from './support.tsx';

const FOCUS_CLIPS = ['brake-early', 'brake-late', 'slow-corner', 'throttle-late', 'off-line', 'wide-apex'].flatMap(kind =>
  [1, 2, 3].map(turn => `focus-${kind}-${turn}`)
);
const ARMED_CLIPS = ['hard-brake', 'speed-85', 'full-throttle', 'ease-off', 'big-stop', 'tighter', 'keep-left', 'keep-right', 'guidance-paused', 'guidance-resumed', ...FOCUS_CLIPS];

const ARMED = { captureId: 'cap-9', exerciseId: 'ex-1', referenceId: 'ref-demo' };

function driveApi(): ApiStub {
  rememberExercise();
  return exerciseApi(exercise({ step: 3 }))
    .on('POST /api/training/arm', (body: unknown) => ({ status: 201, body: { ...ARMED, mode: (body as { mode: string }).mode } }))
    .on('POST /api/training/disarm', { status: 201, body: { ok: true } })
    .on('POST /api/training/manual', { status: 201, body: { ok: true } });
}

function driving(overrides: Partial<LiveState> = {}): LiveState {
  return liveState({
    mode: 'driving',
    connection: 'connected',
    exerciseId: 'ex-1',
    attemptNumber: 2,
    sM: 300,
    speedKph: 142,
    trainingMode: 'guided',
    referenceId: 'ref-demo',
    ...overrides
  });
}

async function openDrive(path = '/drive?mode=guided', state: LiveState = liveState()) {
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
    expect(screen.getByText('Next in 120 m: Full throttle')).toBeInTheDocument();
    expect(screen.getByText('142')).toBeInTheDocument();
  });

  it('drive_is_dark_in_light_theme', async () => {
    setViewportWidth(390);
    document.documentElement.dataset.theme = 'light';
    driveApi().install();
    await openDrive('/drive', driving());
    expect(document.querySelector('.drive-stage')).toHaveAttribute('data-surface', 'night');
  });

  it('voice_not_ready_is_visible_and_arming_asks_confirmation', async () => {
    setViewportWidth(1280);
    const api = driveApi().install();
    await openDrive('/drive?mode=guided', liveState({ voiceDeviceId: null }));
    expect(screen.getAllByText('Voice not ready').length).toBeGreaterThan(0);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Arm a guided attempt' }));
    expect(api.called('POST /api/training/arm')).toBe(false);
    expect(screen.getByText(/No device plays the voice/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Arm without voice' }));
    await waitFor(() =>
      expect(api.calls.find(call => call.path === '/api/training/arm')?.body).toEqual({ exerciseId: 'ex-1', mode: 'guided', confirmNoVoice: true })
    );
  });

  it('arming_guided_preloads_reference_clips_first', async () => {
    setViewportWidth(1280);
    const api = driveApi().install();
    const rig = playerRig();
    await rig.player.unlock();
    const order: string[] = [];
    const preload = vi.spyOn(rig.player, 'preload').mockImplementation(async keys => {
      order.push(`preload:${[...keys].sort().join(',')}`);
    });
    const view = renderApp({ path: '/drive?mode=guided', player: rig.player });
    await screen.findByRole('heading', { name: 'Drive' });
    await waitFor(() => view.sockets.latest);
    act(() => {
      view.sockets.latest.open();
      view.sockets.latest.receive({ type: 'state', state: liveState({ voiceDeviceId: voiceDeviceId(), voiceReady: true }) });
    });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Arm a guided attempt' }));
    await waitFor(() => expect(api.called('POST /api/training/arm')).toBe(true));
    expect(preload).toHaveBeenCalledTimes(1);
    expect(order[0]).toBe(`preload:${[...ARMED_CLIPS].sort().join(',')}`);
    const armIndex = api.calls.findIndex(call => call.path === '/api/training/arm');
    const cuesIndex = api.calls.findIndex(call => call.path === '/api/references/ref-demo/cues');
    expect(cuesIndex).toBeLessThan(armIndex);
    expect(api.calls.find(call => call.path === '/api/training/arm')?.body).toEqual({ exerciseId: 'ex-1', mode: 'guided' });
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

  it('another_device_shows_the_baseline_mode_from_the_server', async () => {
    setViewportWidth(390);
    driveApi().install();
    await openDrive('/drive', driving({ trainingMode: 'baseline', lastCue: null, nextCue: { text: 'Brake to eighty five', inM: 50 } }));
    expect(screen.getByRole('status', { name: 'Current cue' })).toHaveTextContent('Recording without voice');
    expect(screen.queryByText(/Next in 50 m/)).not.toBeInTheDocument();
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
        state: liveState({ seq: 2, mode: 'armed', exerciseId: 'ex-1', trainingMode: 'guided', referenceId: 'ref-demo', voiceDeviceId: voiceDeviceId(), voiceReady: true })
      })
    );
    await waitFor(() => expect(preload).toHaveBeenCalledWith(ARMED_CLIPS));
  });

  it('baseline_mode_shows_no_cue_area_text', async () => {
    setViewportWidth(390);
    driveApi().install();
    const { socket } = await openDrive('/drive?mode=baseline', liveState());
    await userEvent.setup().click(screen.getByRole('button', { name: 'Arm a baseline attempt' }));
    await screen.findByRole('button', { name: 'Stop training' });
    send(socket, driving({ seq: 2, lastCue: null, trainingMode: 'baseline' }));
    expect(screen.getByRole('status', { name: 'Current cue' })).toHaveTextContent('Recording without voice');
  });
});

const ATTEMPT: AttemptSummary = {
  id: 'att-1',
  exerciseId: 'ex-1',
  number: 2,
  referenceId: 'ref-demo',
  captureId: 'cap-9',
  first: 1162,
  last: 2786,
  mode: 'guided',
  completion: 'complete',
  reason: null,
  measuredMs: 27100,
  officialMs: null,
  medal: null,
  timeMs: 27100,
  gapToBestMs: 350,
  largestDifference: { kind: 'brake-early', eventKey: 'brake@332', sM: 332, size: 14.2, unit: 'm' },
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
    let current = ATTEMPT;
    return driveApi()
      .on('GET /api/attempts/att-1', () => current)
      .on('PATCH /api/attempts/att-1', (body: unknown) => {
        const officialMs = (body as { officialMs: number }).officialMs;
        current = { ...current, officialMs, timeMs: officialMs };
        return current;
      })
      .install();
  }

  it('summary_appears_on_finished_with_time_gap_and_largest_difference', async () => {
    setViewportWidth(390);
    summaryApi();
    await openDrive('/drive', driving({ mode: 'finished', lastAttemptId: 'att-1' }));
    const summary = await screen.findByRole('region', { name: 'Attempt 2' });
    expect(summary).toHaveTextContent('0:27.10');
    expect(summary).toHaveTextContent('+0.35 s');
    expect(summary).toHaveTextContent('332 m. Braked 14 m earlier');
    expect(screen.getByRole('link', { name: 'Review this attempt' })).toHaveAttribute('href', '/attempts/att-1/review');
  });

  it('summary_shows_the_focus_sentence', async () => {
    setViewportWidth(390);
    driveApi()
      .on('GET /api/attempts/att-1', { ...ATTEMPT, focus: { text: 'Turn one. Brake later.', turn: 1, kind: 'brake-early' } })
      .install();
    await openDrive('/drive', driving({ mode: 'finished', lastAttemptId: 'att-1' }));
    const summary = await screen.findByRole('region', { name: 'Attempt 2' });
    expect(within(summary).getByText('Turn one. Brake later.')).toBeInTheDocument();
    expect(summary).toHaveTextContent('Focus for the next attempt');
  });

  it('summary_without_focus_has_no_focus_line', async () => {
    setViewportWidth(390);
    summaryApi();
    await openDrive('/drive', driving({ mode: 'finished', lastAttemptId: 'att-1' }));
    const summary = await screen.findByRole('region', { name: 'Attempt 2' });
    expect(summary).not.toHaveTextContent('Focus for the next attempt');
  });

  it('summary_labels_time_as_measured', async () => {
    setViewportWidth(1280);
    summaryApi();
    await openDrive('/drive', driving({ mode: 'finished', lastAttemptId: 'att-1' }));
    const summary = await screen.findByRole('region', { name: 'Attempt 2' });
    expect(summary).toHaveTextContent('Measured from telemetry');
    expect(summary).not.toHaveTextContent('Official time:');
  });

  it('official_time_can_be_entered', async () => {
    setViewportWidth(1280);
    const api = summaryApi();
    await openDrive('/drive', driving({ mode: 'finished', lastAttemptId: 'att-1' }));
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Official time from the game'), '0:27.054');
    await user.click(screen.getByRole('button', { name: 'Save official time' }));
    await waitFor(() => expect(api.calls.find(call => call.method === 'PATCH')?.body).toEqual({ officialMs: 27054 }));
    expect(await screen.findByText('Official time: 0:27.054')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Attempt 2' })).toHaveTextContent('0:27.054');
  });

  it('summary_never_shows_the_previous_attempt_while_the_next_loads', async () => {
    setViewportWidth(1280);
    summaryApi().on('GET /api/attempts/att-2', () => new Promise(() => undefined));
    const { socket } = await openDrive('/drive', driving({ mode: 'finished', lastAttemptId: 'att-1' }));
    await screen.findByRole('region', { name: 'Attempt 2' });
    send(socket, driving({ seq: 2, mode: 'finished', lastAttemptId: 'att-2' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Attempt 2' })).not.toBeInTheDocument());
    expect(screen.queryByLabelText('Official time from the game')).not.toBeInTheDocument();
  });

  it('official_time_rejects_text_that_is_not_a_time', async () => {
    setViewportWidth(1280);
    const api = summaryApi();
    await openDrive('/drive', driving({ mode: 'finished', lastAttemptId: 'att-1' }));
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Official time from the game'), 'fast');
    await user.click(screen.getByRole('button', { name: 'Save official time' }));
    expect(await screen.findByText(/Enter the time as the game shows it/)).toBeInTheDocument();
    expect(api.calls.some(call => call.method === 'PATCH')).toBe(false);
  });
});
