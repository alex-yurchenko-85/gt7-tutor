import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CaptureInfo, ReferenceProposal } from '@gt7/contracts';
import { EXERCISE_ID, exercise, exerciseApi, reference, REFERENCE_ID } from './fixtures.ts';
import { liveState, playerRig, renderApp, setViewportWidth, type ApiStub } from './support.tsx';
import { voiceDeviceId } from '../src/voice/device.ts';
import { COUNTDOWN_CLIPS } from '../src/voice/clips.ts';

function captureInfo(id: string, overrides: Partial<CaptureInfo> = {}): CaptureInfo {
  return {
    id,
    exerciseId: EXERCISE_ID,
    purpose: 'demo',
    startedAt: '2026-11-16T10:00:00.000Z',
    endedAt: null,
    packets: 0,
    complete: true,
    errorReason: null,
    startCueMonoMs: 5000,
    active: true,
    ...overrides
  };
}

const PROPOSALS: ReferenceProposal[] = [
  {
    ranges: [
      { captureId: 'cap-1', first: 352, last: 1897 },
      { captureId: 'cap-2', first: 655, last: 2200 },
      { captureId: 'cap-3', first: 978, last: 2523 }
    ],
    sampleCount: 1546,
    ambiguous: true,
    evidence: ['repeats in 3 captures', 'starts after the START cue']
  },
  {
    ranges: [
      { captureId: 'cap-1', first: 100, last: 300 },
      { captureId: 'cap-2', first: 400, last: 600 }
    ],
    sampleCount: 201,
    ambiguous: true,
    evidence: ['repeats in 2 captures']
  }
];

function recordingApi(options: { ps5Ip?: string | null; consoleRequired?: boolean } = {}): ApiStub {
  let next = 0;
  const api = exerciseApi(exercise({ step: 1, activeReferenceId: null }))
    .on('GET /api/settings', { ps5Ip: options.ps5Ip === undefined ? '10.0.0.5' : options.ps5Ip, gameVersion: null })
    .on('GET /api/app-info', { demo: null, consoleRequired: options.consoleRequired ?? true })
    .on('POST /api/captures', () => ({ status: 201, body: captureInfo(`cap-${++next}`) }))
    .on('POST /api/exercises/e0000000-0000-4000-8000-000000000001/reference-proposals', PROPOSALS)
    .on('POST /api/references', { status: 201, body: reference() })
    .on(`POST /api/references/${REFERENCE_ID}/check`, { matched: true, range: { first: 10, last: 1555 }, reference: reference() });
  for (const id of ['cap-1', 'cap-2', 'cap-3']) api.on(`POST /api/captures/${id}/stop`, { status: 201, body: captureInfo(id, { active: false, packets: 2500 }) });
  return api.install();
}

async function recordAll(user: ReturnType<typeof userEvent.setup>, count: number, delays: number[]) {
  for (let index = 0; index < count; index++) {
    await user.click(await screen.findByRole('button', { name: `Start recording ${index + 1} of ${count}` }));
    const countdown = await screen.findByRole('timer');
    expect(countdown).toHaveTextContent(String(delays[index]));
    act(() => vi.advanceTimersByTime(delays[index]! * 1000));
    expect(countdown).toHaveTextContent('START');
    await user.click(screen.getByRole('button', { name: `Stop recording ${index + 1}` }));
  }
}

describe('reference recording', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('recording_wizard_runs_three_recordings', async () => {
    setViewportWidth(1280);
    const api = recordingApi();
    renderApp({ path: '/exercises/e0000000-0000-4000-8000-000000000001/record' });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await recordAll(user, 3, [5, 10, 15]);
    const starts = api.calls.filter(call => call.method === 'POST' && call.path === '/api/captures').map(call => call.body);
    expect(starts).toEqual([5, 10, 15].map(startAfterS => ({ exerciseId: EXERCISE_ID, purpose: 'demo', startAfterS })));
    await waitFor(() => expect(api.called('POST /api/exercises/e0000000-0000-4000-8000-000000000001/reference-proposals')).toBe(true));
    expect(api.calls.find(call => call.path.endsWith('reference-proposals'))?.body).toEqual({ captureIds: ['cap-1', 'cap-2', 'cap-3'] });
  });

  it('proposal_shows_candidates_and_needs_confirmation', async () => {
    setViewportWidth(1280);
    const api = recordingApi();
    renderApp({ path: '/exercises/e0000000-0000-4000-8000-000000000001/record' });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await recordAll(user, 3, [5, 10, 15]);
    const candidates = await screen.findByRole('radiogroup', { name: 'Candidate ranges' });
    expect(within(candidates).getAllByRole('radio')).toHaveLength(2);
    expect(screen.getByText(/More than one range repeats/)).toBeInTheDocument();
    const confirm = screen.getByRole('button', { name: 'Confirm reference' });
    expect(confirm).toBeDisabled();
    await user.click(within(candidates).getAllByRole('radio')[0]!);
    expect(confirm).toBeDisabled();
    await user.click(screen.getByRole('radio', { name: /Flying start/ }));
    expect(confirm).toBeEnabled();
    expect(api.called('POST /api/references')).toBe(false);
    await user.click(confirm);
    await waitFor(() =>
      expect(api.calls.find(call => call.path === '/api/references')?.body).toEqual({
        exerciseId: EXERCISE_ID,
        captureId: 'cap-1',
        first: 352,
        last: 1897,
        startKind: 'flying'
      })
    );
  });

  it('manual_range_is_available', async () => {
    setViewportWidth(1280);
    const api = recordingApi().on('GET /api/captures', [
      captureInfo('cap-old', { active: false, packets: 2571, endedAt: '2026-11-16T10:01:00.000Z' }),
      captureInfo('cap-other', { active: false, exerciseId: 'e0000000-0000-4000-8000-000000000002' })
    ]);
    renderApp({ path: '/exercises/e0000000-0000-4000-8000-000000000001/record' });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(await screen.findByRole('button', { name: 'Set the range by hand' }));
    const form = screen.getByRole('form', { name: 'Manual range' });
    expect(within(form).getAllByRole('option').map(option => option.getAttribute('value'))).toEqual(['cap-old']);
    await user.type(within(form).getByLabelText('First frame'), '352');
    await user.type(within(form).getByLabelText('Last frame'), '1897');
    await user.click(within(form).getByRole('radio', { name: /Standing start/ }));
    await user.click(within(form).getByRole('button', { name: 'Create reference' }));
    await waitFor(() =>
      expect(api.calls.find(call => call.path === '/api/references')?.body).toEqual({
        exerciseId: EXERCISE_ID,
        captureId: 'cap-old',
        first: 352,
        last: 1897,
        startKind: 'standing'
      })
    );
  });

  it('failed_check_can_be_retried', async () => {
    setViewportWidth(1280);
    let calls = 0;
    recordingApi()
      .on('GET /api/exercises/e0000000-0000-4000-8000-000000000001/references', [reference({ needsCheck: true })])
      .on(`POST /api/references/${REFERENCE_ID}/check`, () =>
        ++calls === 1
          ? { status: 500, body: { statusCode: 500, message: 'Internal server error' } }
          : { status: 201, body: { matched: true, range: { first: 10, last: 1555 }, reference: reference() } }
      );
    renderApp({ path: `/exercises/e0000000-0000-4000-8000-000000000001/record?check=${REFERENCE_ID}` });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await recordAll(user, 1, [5]);
    await user.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByText(/The new recording matches the reference/)).toBeInTheDocument();
    expect(calls).toBe(2);
  });

  it('record_view_resumes_a_running_recording', async () => {
    setViewportWidth(1280);
    const api = recordingApi().on('GET /api/captures', [
      captureInfo('cap-running', { startedAt: new Date(Date.now() - 8000).toISOString(), startCueMonoMs: 5000 })
    ]);
    api.on('POST /api/captures/cap-running/stop', { status: 201, body: captureInfo('cap-running', { active: false, packets: 2400 }) });
    renderApp({ path: '/exercises/e0000000-0000-4000-8000-000000000001/record' });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    expect(await screen.findByRole('timer')).toHaveTextContent('START');
    await user.click(screen.getByRole('button', { name: 'Stop recording 1' }));
    await waitFor(() => expect(api.called('POST /api/captures/cap-running/stop')).toBe(true));
  });

  it('needs_check_badge_starts_one_recording_check', async () => {
    setViewportWidth(1280);
    const api = recordingApi().on('GET /api/exercises/e0000000-0000-4000-8000-000000000001/references', [reference({ needsCheck: true, gameVersion: '1.60' })]);
    renderApp({ path: '/exercises/e0000000-0000-4000-8000-000000000001/references' });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    expect(await screen.findByText('Needs a check')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Check with one recording' }));
    expect(await screen.findByRole('heading', { name: 'Check the reference' })).toBeInTheDocument();
    await recordAll(user, 1, [5]);
    await waitFor(() => expect(api.calls.find(call => call.path === `/api/references/${REFERENCE_ID}/check`)?.body).toEqual({ captureId: 'cap-1' }));
    expect(await screen.findByText(/The new recording matches the reference/)).toBeInTheDocument();
  });

  it('countdown_starts_at_the_full_wait_after_time_on_the_page', async () => {
    setViewportWidth(1280);
    recordingApi();
    renderApp({ path: '/exercises/e0000000-0000-4000-8000-000000000001/record' });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const start = await screen.findByRole('button', { name: 'Start recording 1 of 3' });
    act(() => vi.advanceTimersByTime(30000));
    const shown: string[] = [];
    const observer = new MutationObserver(() => {
      const timer = document.querySelector('[role="timer"]');
      if (timer) shown.push(timer.textContent ?? '');
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    await user.click(start);
    await screen.findByRole('timer');
    observer.disconnect();
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.every(text => text === '5')).toBe(true);
  });

  it('start_disabled_without_console_address', async () => {
    setViewportWidth(1280);
    recordingApi({ ps5Ip: null, consoleRequired: true });
    renderApp({ path: '/exercises/e0000000-0000-4000-8000-000000000001/record' });
    expect(await screen.findByText('Enter the PS5 address in Setup first.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start recording 1 of 3' })).toBeDisabled();
    expect(screen.getByRole('link', { name: 'Open Setup' })).toHaveAttribute('href', '/setup#console');
    expect(screen.getByText('Console: no address')).toBeInTheDocument();
  });

  it('start_allowed_with_replay_without_address', async () => {
    setViewportWidth(1280);
    recordingApi({ ps5Ip: null, consoleRequired: false });
    renderApp({ path: '/exercises/e0000000-0000-4000-8000-000000000001/record' });
    expect(await screen.findByText('Console: recorded data')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start recording 1 of 3' })).toBeEnabled();
    expect(screen.queryByText('Enter the PS5 address in Setup first.')).toBeNull();
  });

  it('server_refusal_without_address_shows_the_setup_link', async () => {
    setViewportWidth(1280);
    recordingApi({ ps5Ip: null, consoleRequired: false }).on('POST /api/captures', {
      status: 409,
      body: { code: 'console-address-missing', reason: 'Enter the PS5 address in Setup before a capture.' }
    });
    renderApp({ path: '/exercises/e0000000-0000-4000-8000-000000000001/record' });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(await screen.findByRole('button', { name: 'Start recording 1 of 3' }));
    expect(await screen.findByText('Enter the PS5 address in Setup first.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Setup' })).toHaveAttribute('href', '/setup#console');
  });

  it('countdown_shows_the_spoken_word', async () => {
    setViewportWidth(1280);
    recordingApi();
    const { sockets, player } = renderRecording();
    const socket = await waitFor(() => sockets.latest);
    act(() => {
      socket.open();
      socket.receive({ type: 'state', state: liveState({ voiceDeviceId: 'phone-1', voiceReady: true }) });
    });
    expect(await screen.findByText('Voice: another device speaks the countdown')).toBeInTheDocument();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(await screen.findByRole('button', { name: 'Start recording 1 of 3' }));
    const countdown = await screen.findByRole('timer');
    expect(countdown).toHaveTextContent('5');
    expect(screen.getByText('The voice starts at three.')).toBeInTheDocument();
    expect(screen.queryByText(/look at the TV/i)).toBeNull();
    act(() => vi.advanceTimersByTime(2000));
    expect(countdown).toHaveTextContent('3');
    expect(screen.getByText('The voice says “three”.')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(3000));
    expect(countdown).toHaveTextContent('START');
    expect(screen.getByText(/^Recording, 0 s\. Stop when the demonstration has ended\.$/)).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(12000));
    expect(screen.getByText(/^Recording, 12 s\./)).toBeInTheDocument();
  });

  it('record_page_preloads_the_countdown_when_this_device_is_the_voice', async () => {
    setViewportWidth(1280);
    recordingApi();
    const { sockets, player } = renderRecording();
    const socket = await waitFor(() => sockets.latest);
    act(() => {
      socket.open();
      socket.receive({ type: 'state', state: liveState({ voiceDeviceId: voiceDeviceId(), voiceReady: true }) });
    });
    expect(await screen.findByText('Voice: this device speaks the countdown')).toBeInTheDocument();
    expect(screen.getByText('Then press Start here. The voice counts down from 5. On “start”, start the demonstration in the game.')).toBeInTheDocument();
    await waitFor(() => expect(COUNTDOWN_CLIPS.every(clip => player.hasClip(clip))).toBe(true));
  });

  it('without_voice_the_countdown_is_shown_only', async () => {
    setViewportWidth(1280);
    recordingApi();
    const { sockets } = renderRecording();
    const socket = await waitFor(() => sockets.latest);
    act(() => {
      socket.open();
      socket.receive({ type: 'state', state: liveState() });
    });
    expect(await screen.findByText('Voice: no device, the countdown is shown only')).toBeInTheDocument();
  });

  it('cancel_stops_the_capture_and_keeps_the_count', async () => {
    setViewportWidth(1280);
    const api = recordingApi();
    renderApp({ path: '/exercises/e0000000-0000-4000-8000-000000000001/record' });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(await screen.findByRole('button', { name: 'Start recording 1 of 3' }));
    await user.click(await screen.findByRole('button', { name: 'Cancel this recording' }));
    await waitFor(() => expect(api.called('POST /api/captures/cap-1/stop')).toBe(true));
    expect(await screen.findByRole('button', { name: 'Start recording 1 of 3' })).toBeEnabled();
  });

  it('no_proposal_offers_to_record_again', async () => {
    setViewportWidth(1280);
    const api = recordingApi().on('POST /api/exercises/e0000000-0000-4000-8000-000000000001/reference-proposals', []);
    renderApp({ path: '/exercises/e0000000-0000-4000-8000-000000000001/record' });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await recordAll(user, 3, [5, 10, 15]);
    expect(await screen.findByRole('heading', { name: 'No complete demonstration found' })).toBeInTheDocument();
    expect(
      screen.getByText(
        'A range must repeat in every recording and show the timer of the demonstration from start to finish. Record again and let each demonstration play to the end, or set the range by hand.'
      )
    ).toBeInTheDocument();
    expect(screen.queryByText(/No range repeats/)).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Three recordings done' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Record again' }));
    expect(await screen.findByRole('button', { name: 'Start recording 1 of 3' })).toBeEnabled();
    expect(api.calls.filter(call => call.path === '/api/captures' && call.method === 'POST')).toHaveLength(3);
  });

  it('manual_range_explains_the_timer_cut_and_the_refusal', async () => {
    setViewportWidth(1280);
    recordingApi()
      .on('GET /api/captures', [captureInfo('cap-old', { active: false, packets: 2571, endedAt: '2026-11-16T10:01:00.000Z' })])
      .on('POST /api/references', { status: 400, body: { code: 'no-timer-run', reason: 'The range has no complete game timer run.' } });
    renderApp({ path: '/exercises/e0000000-0000-4000-8000-000000000001/record' });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(await screen.findByRole('button', { name: 'Set the range by hand' }));
    const form = screen.getByRole('form', { name: 'Manual range' });
    expect(within(form).getByText('GT7 Tutor keeps only the part where the demonstration timer runs.')).toBeInTheDocument();
    await user.type(within(form).getByLabelText('First frame'), '420');
    await user.type(within(form).getByLabelText('Last frame'), '1310');
    await user.click(within(form).getByRole('radio', { name: /Flying start/ }));
    await user.click(within(form).getByRole('button', { name: 'Create reference' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent(
      'This range does not hold the whole run of the demonstration timer. Choose frames from before the demonstration starts to after it finishes.'
    );
  });

  it('manual_range_is_a_text_link', async () => {
    setViewportWidth(1280);
    recordingApi();
    renderApp({ path: '/exercises/e0000000-0000-4000-8000-000000000001/record' });
    const hint = await screen.findByText('Experienced user?');
    const open = within(hint.closest('p')!).getByRole('button', { name: 'Set the range by hand' });
    expect(open).toHaveClass('text-link');
  });

  it('created_links_back_to_the_exercise_page', async () => {
    setViewportWidth(1280);
    recordingApi().on('POST /api/exercises/e0000000-0000-4000-8000-000000000001/reference-proposals', [{ ...PROPOSALS[0]!, ambiguous: false }]);
    renderApp({ path: '/exercises/e0000000-0000-4000-8000-000000000001/record' });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await recordAll(user, 3, [5, 10, 15]);
    expect(await screen.findByRole('heading', { name: 'Three recordings done' })).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: /Flying start/ }));
    await user.click(screen.getByRole('button', { name: 'Confirm reference' }));
    expect(await screen.findByRole('heading', { name: 'The reference is active' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to the exercise' })).toHaveAttribute('href', `/exercises/${EXERCISE_ID}`);
    expect(screen.getByRole('link', { name: 'Hear the cues' })).toHaveAttribute('href', `/exercises/${EXERCISE_ID}/cues`);
  });

  it('phone_recording_hides_navigation', async () => {
    setViewportWidth(390);
    recordingApi();
    renderApp({ path: '/exercises/e0000000-0000-4000-8000-000000000001/record' });
    const start = await screen.findByRole('button', { name: 'Start recording 1' });
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull();
    expect(screen.queryByRole('banner')).toBeNull();
    expect(screen.getByRole('link', { name: 'Close' })).toHaveAttribute('href', `/exercises/${EXERCISE_ID}`);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(start);
    expect(await screen.findByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(5000));
    expect(screen.getByRole('button', { name: 'Stop recording 1' })).toBeInTheDocument();
  });
});

function renderRecording() {
  const rig = playerRig();
  const { sockets } = renderApp({ path: '/exercises/e0000000-0000-4000-8000-000000000001/record', player: rig.player });
  return { sockets, player: rig.player };
}
