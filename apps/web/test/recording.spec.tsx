import { act, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CaptureInfo, ReferenceProposal } from '@gt7/contracts';
import { EXERCISE_ID, exercise, exerciseApi, reference, REFERENCE_ID } from './fixtures.ts';
import { renderApp, sendLiveState, setViewportWidth, timedUser, type ApiStub } from './support.tsx';

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
    active: true,
    ...overrides
  };
}

const PROPOSALS_PATH = `POST /api/exercises/${EXERCISE_ID}/reference-proposals`;

const FOUND: ReferenceProposal[] = [
  {
    ranges: [{ captureId: 'cap-1', first: 457, last: 1422 }],
    sampleCount: 966,
    ambiguous: false,
    evidence: ['Timer runs 16.082 s'],
    timeMs: 16082
  }
];

const TWO_RUNS: ReferenceProposal[] = [
  {
    ranges: [{ captureId: 'cap-1', first: 758, last: 970 }],
    sampleCount: 213,
    ambiguous: true,
    evidence: ['Timer runs 3.533 s'],
    timeMs: 3533
  },
  {
    ranges: [{ captureId: 'cap-1', first: 1054, last: 2019 }],
    sampleCount: 966,
    ambiguous: true,
    evidence: ['Timer runs 16.082 s'],
    timeMs: 16082
  }
];

const REPEATS: ReferenceProposal[] = [
  {
    ranges: [
      { captureId: 'cap-1', first: 457, last: 1422 },
      { captureId: 'cap-2', first: 738, last: 1703 }
    ],
    sampleCount: 966,
    ambiguous: true,
    evidence: ['Capture 1: timer runs 16.082 s', 'Capture 2: timer runs 16.082 s'],
    timeMs: 16082
  }
];

type ProposalOptions = { runs?: ReferenceProposal[]; repeats?: ReferenceProposal[] };

function recordingApi(options: { ps5Ip?: string | null; consoleRequired?: boolean } & ProposalOptions = {}): ApiStub {
  let next = 0;
  const api = exerciseApi(exercise({ step: 1, activeReferenceId: null }))
    .on('GET /api/settings', { ps5Ip: options.ps5Ip === undefined ? '10.0.0.5' : options.ps5Ip, gameVersion: null })
    .on('GET /api/app-info', { demo: null, consoleRequired: options.consoleRequired ?? true })
    .on('POST /api/captures', () => ({ status: 201, body: captureInfo(`cap-${++next}`) }))
    .on(PROPOSALS_PATH, (body: unknown) => ((body as { captureIds: string[] }).captureIds.length === 1 ? (options.runs ?? FOUND) : (options.repeats ?? REPEATS)))
    .on('POST /api/references', { status: 201, body: reference() })
    .on(`POST /api/references/${REFERENCE_ID}/check`, { matched: true, range: { first: 10, last: 1555 }, reference: reference() });
  for (const id of ['cap-1', 'cap-2', 'cap-3']) {
    api.on(`POST /api/captures/${id}/stop`, { status: 201, body: captureInfo(id, { active: false, packets: 2500, endedAt: '2026-11-16T10:00:38.000Z' }) });
  }
  return api.install();
}

async function recordOnce(user: ReturnType<typeof timedUser>, number: number) {
  await user.click(await screen.findByRole('button', { name: 'Start recording' }));
  expect(await screen.findByRole('timer')).toHaveTextContent('0');
  await user.click(screen.getByRole('button', { name: `Stop recording ${number}` }));
}

function slotTexts(): string[] {
  return within(screen.getByRole('list', { name: 'Recordings' }))
    .getAllByRole('listitem')
    .map(item => item.textContent ?? '');
}

function referenceBody(api: ApiStub): unknown {
  return api.calls.find(call => call.path === '/api/references')?.body;
}

describe('reference recording', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  it('one_recording_finds_the_demonstration_and_creates_the_reference', async () => {
    const api = recordingApi();
    renderApp({ path: `/exercises/${EXERCISE_ID}/record` });
    const user = timedUser();
    await recordOnce(user, 1);
    expect(await screen.findByRole('heading', { name: 'The demonstration is found' })).toBeInTheDocument();
    expect(api.calls.find(call => call.path.endsWith('reference-proposals'))?.body).toEqual({ captureIds: ['cap-1'] });
    expect(
      screen.getByText(
        'The demonstration takes 0:16.082 in recording 1, frames 457–1422. Use it as the reference, or record once more to check that the same part repeats.'
      )
    ).toBeInTheDocument();
    expect(slotTexts()).toEqual(['Recording 1done, 38 s', 'Recording 2optional, a check']);
    expect(screen.getByRole('button', { name: 'Record again to check' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Use this as the reference' }));
    expect(await screen.findByRole('heading', { name: 'The reference is active' })).toBeInTheDocument();
    expect(referenceBody(api)).toEqual({ exerciseId: EXERCISE_ID, captureId: 'cap-1', first: 457, last: 1422 });
    expect(screen.getByText('Next: drive attempts. The Drive screen shows the cues, and a voice device also says them.')).toBeInTheDocument();
    expect(slotTexts()).toEqual(['Recording 1done, 38 s', 'Recording 2not needed']);
    expect(api.calls.filter(call => call.path === '/api/captures' && call.method === 'POST')).toHaveLength(1);
  });

  it('two_timer_runs_need_a_selection', async () => {
    const api = recordingApi({ runs: TWO_RUNS });
    renderApp({ path: `/exercises/${EXERCISE_ID}/record` });
    const user = timedUser();
    await recordOnce(user, 1);
    expect(await screen.findByRole('heading', { name: 'Select the demonstration' })).toBeInTheDocument();
    const runs = screen.getByRole('radiogroup', { name: 'Demonstrations' });
    expect(within(runs).getAllByRole('radio')).toHaveLength(2);
    expect(within(runs).getByText('Demonstrations in recording 1')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Recording 1 holds more than one demonstration. Select one. Use it as the reference, or record once more to check that the same part repeats.'
      )
    ).toBeInTheDocument();
    expect(within(runs).getByText('0:03.533, frames 758–970')).toBeInTheDocument();
    const use = screen.getByRole('button', { name: 'Use this as the reference' });
    expect(use).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Record again to check' })).toBeDisabled();
    await user.click(within(runs).getAllByRole('radio')[1]!);
    expect(use).toBeEnabled();
    await user.click(use);
    await waitFor(() => expect(referenceBody(api)).toEqual({ exerciseId: EXERCISE_ID, captureId: 'cap-1', first: 1054, last: 2019 }));
  });

  it('recording_two_says_that_the_same_part_repeats', async () => {
    const api = recordingApi();
    renderApp({ path: `/exercises/${EXERCISE_ID}/record` });
    const user = timedUser();
    await recordOnce(user, 1);
    await user.click(await screen.findByRole('button', { name: 'Record again to check' }));
    await recordOnce(user, 2);
    expect(await screen.findByText('The same part repeats in both recordings.')).toBeInTheDocument();
    expect(api.calls.filter(call => call.path.endsWith('reference-proposals')).map(call => call.body)).toEqual([
      { captureIds: ['cap-1'] },
      { captureIds: ['cap-1', 'cap-2'] }
    ]);
    expect(slotTexts()).toEqual(['Recording 1done, 38 s', 'Recording 2done, 38 s']);
    await user.click(screen.getByRole('button', { name: 'Use this as the reference' }));
    expect(await screen.findByRole('heading', { name: 'The reference is active' })).toBeInTheDocument();
    expect(referenceBody(api)).toEqual({ exerciseId: EXERCISE_ID, captureId: 'cap-1', first: 457, last: 1422 });
    expect(slotTexts()).toEqual(['Recording 1done, 38 s', 'Recording 2done, 38 s']);
  });

  it('recording_two_that_does_not_repeat_offers_recording_one', async () => {
    const api = recordingApi({ repeats: [{ ...REPEATS[0]!, ranges: [{ captureId: 'cap-1', first: 100, last: 300 }, { captureId: 'cap-2', first: 400, last: 600 }] }] });
    renderApp({ path: `/exercises/${EXERCISE_ID}/record` });
    const user = timedUser();
    await recordOnce(user, 1);
    await user.click(await screen.findByRole('button', { name: 'Record again to check' }));
    await recordOnce(user, 2);
    expect(await screen.findByText('The recordings do not show the same part. Use recording 1, or record again.')).toBeInTheDocument();
    expect(screen.queryByText('The same part repeats in both recordings.')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Record again' }));
    expect(await screen.findByRole('button', { name: 'Start recording' })).toBeEnabled();
    expect(slotTexts()).toEqual(['Recording 1needed', 'Recording 2optional, a check']);
    expect(api.called('POST /api/references')).toBe(false);
  });

  it('record_page_shows_one_needed_and_one_optional_recording', async () => {
    recordingApi();
    renderApp({ path: `/exercises/${EXERCISE_ID}/record` });
    expect(await screen.findByRole('button', { name: 'Start recording' })).toBeEnabled();
    expect(
      screen.getByText('The game shows a demonstration before every run. GT7 Tutor records it once and finds the demonstration by itself.')
    ).toBeInTheDocument();
    expect(
      screen.getByText('Then press Start recording here, and start the demonstration in the game. Stop when the demonstration has ended.')
    ).toBeInTheDocument();
    expect(slotTexts()).toEqual(['Recording 1needed', 'Recording 2optional, a check']);
    expect(screen.getByRole('heading', { name: 'Why one recording' })).toBeInTheDocument();
    expect(
      screen.getByText(
        'GT7 Tutor finds the start and the end of the demonstration in one recording. A second recording is optional: it checks that the same part repeats.'
      )
    ).toBeInTheDocument();
    expect(screen.queryByText('The phone as the voice device')).toBeNull();
    expect(screen.queryByText(/Recording 3|three/i)).toBeNull();
  });

  it('manual_range_is_available', async () => {
    const api = recordingApi().on('GET /api/captures', [
      captureInfo('cap-old', { active: false, packets: 2571, endedAt: '2026-11-16T10:01:00.000Z' }),
      captureInfo('cap-other', { active: false, exerciseId: 'e0000000-0000-4000-8000-000000000002' })
    ]);
    renderApp({ path: `/exercises/${EXERCISE_ID}/record` });
    const user = timedUser();
    await user.click(await screen.findByRole('button', { name: 'Set the range by hand' }));
    const form = screen.getByRole('form', { name: 'Manual range' });
    expect(within(form).getAllByRole('option').map(option => option.getAttribute('value'))).toEqual(['cap-old']);
    await user.type(within(form).getByLabelText('First frame'), '352');
    await user.type(within(form).getByLabelText('Last frame'), '1897');
    await user.click(within(form).getByRole('button', { name: 'Create reference' }));
    await waitFor(() =>
      expect(api.calls.find(call => call.path === '/api/references')?.body).toEqual({
        exerciseId: EXERCISE_ID,
        captureId: 'cap-old',
        first: 352,
        last: 1897
      })
    );
  });

  it('failed_check_can_be_retried', async () => {
    let calls = 0;
    recordingApi()
      .on(`GET /api/exercises/${EXERCISE_ID}/references`, [reference({ needsCheck: true })])
      .on(`POST /api/references/${REFERENCE_ID}/check`, () =>
        ++calls === 1
          ? { status: 500, body: { code: 'server-error' } }
          : { status: 201, body: { matched: true, range: { first: 10, last: 1555 }, reference: reference() } }
      );
    renderApp({ path: `/exercises/${EXERCISE_ID}/record?check=${REFERENCE_ID}` });
    const user = timedUser();
    await recordOnce(user, 1);
    await user.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByText(/The new recording matches the reference/)).toBeInTheDocument();
    expect(calls).toBe(2);
  });

  it('record_view_resumes_a_running_recording', async () => {
    const api = recordingApi().on('GET /api/captures', [
      captureInfo('cap-running', { startedAt: new Date(Date.now() - 8000).toISOString() })
    ]);
    api.on('POST /api/captures/cap-running/stop', { status: 201, body: captureInfo('cap-running', { active: false, packets: 2400 }) });
    renderApp({ path: `/exercises/${EXERCISE_ID}/record` });
    const user = timedUser();
    expect(await screen.findByRole('timer')).toHaveTextContent(/^(8|9)$/);
    await user.click(screen.getByRole('button', { name: 'Stop recording 1' }));
    await waitFor(() => expect(api.called('POST /api/captures/cap-running/stop')).toBe(true));
  });

  it('needs_check_badge_starts_one_recording_check', async () => {
    const api = recordingApi().on(`GET /api/exercises/${EXERCISE_ID}/references`, [reference({ needsCheck: true, gameVersion: '1.60' })]);
    renderApp({ path: `/exercises/${EXERCISE_ID}/references` });
    const user = timedUser();
    expect(await screen.findByText('Needs a check')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Check with one recording' }));
    expect(await screen.findByRole('heading', { name: 'Check the reference' })).toBeInTheDocument();
    await recordOnce(user, 1);
    await waitFor(() => expect(api.calls.find(call => call.path === `/api/references/${REFERENCE_ID}/check`)?.body).toEqual({ captureId: 'cap-1' }));
    expect(await screen.findByText(/The new recording matches the reference/)).toBeInTheDocument();
  });

  it('start_disabled_without_console_address', async () => {
    recordingApi({ ps5Ip: null, consoleRequired: true });
    renderApp({ path: `/exercises/${EXERCISE_ID}/record` });
    expect(await screen.findByText('Enter the PS5 address in Setup first.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start recording' })).toBeDisabled();
    expect(screen.getByRole('link', { name: 'Open Setup' })).toHaveAttribute('href', '/setup#console');
    expect(screen.queryByRole('list', { name: 'Readiness' })).toBeNull();
  });

  it('start_allowed_with_replay_without_address', async () => {
    recordingApi({ ps5Ip: null, consoleRequired: false });
    renderApp({ path: `/exercises/${EXERCISE_ID}/record` });
    await screen.findByRole('button', { name: 'Start recording' });
    expect(screen.queryByRole('list', { name: 'Readiness' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Start recording' })).toBeEnabled();
    expect(screen.queryByText('Enter the PS5 address in Setup first.')).toBeNull();
  });

  it('server_refusal_without_address_shows_the_setup_link', async () => {
    recordingApi({ ps5Ip: null, consoleRequired: false }).on('POST /api/captures', {
      status: 409,
      body: { code: 'console-address-missing' }
    });
    renderApp({ path: `/exercises/${EXERCISE_ID}/record` });
    const user = timedUser();
    await user.click(await screen.findByRole('button', { name: 'Start recording' }));
    expect(await screen.findByText('Enter the PS5 address in Setup first.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Setup' })).toHaveAttribute('href', '/setup#console');
  });

  it('recording_starts_at_once_and_counts_the_seconds', async () => {
    const api = recordingApi();
    renderApp({ path: `/exercises/${EXERCISE_ID}/record` });
    const user = timedUser();
    await user.click(await screen.findByRole('button', { name: 'Start recording' }));
    const timer = await screen.findByRole('timer');
    expect(timer).toHaveTextContent('0');
    expect(screen.getByText(/^Recording, 0 s\. Stop when the demonstration has ended\.$/)).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(12000));
    expect(screen.getByText(/^Recording, 12 s\./)).toBeInTheDocument();
    expect(api.calls.find(call => call.method === 'POST' && call.path === '/api/captures')?.body).toEqual({ exerciseId: EXERCISE_ID, purpose: 'demo' });
  });

  it('record_page_names_no_wait_and_no_voice_chip', async () => {
    recordingApi();
    renderApp({ path: `/exercises/${EXERCISE_ID}/record` });
    await screen.findByRole('button', { name: 'Start recording' });
    expect(screen.queryByText(/wait|Voice:/i)).toBeNull();
  });

  it('cancel_stops_the_capture_and_keeps_the_count', async () => {
    const api = recordingApi();
    renderApp({ path: `/exercises/${EXERCISE_ID}/record` });
    const user = timedUser();
    await user.click(await screen.findByRole('button', { name: 'Start recording' }));
    await user.click(await screen.findByRole('button', { name: 'Cancel this recording' }));
    await waitFor(() => expect(api.called('POST /api/captures/cap-1/stop')).toBe(true));
    expect(await screen.findByRole('button', { name: 'Start recording' })).toBeEnabled();
  });

  it('no_proposal_offers_to_record_again', async () => {
    const api = recordingApi({ runs: [] });
    renderApp({ path: `/exercises/${EXERCISE_ID}/record` });
    const user = timedUser();
    await recordOnce(user, 1);
    expect(await screen.findByRole('heading', { name: 'No complete demonstration found' })).toBeInTheDocument();
    expect(
      screen.getByText(
        'Recording 1 does not hold the whole demonstration. Record again and let the demonstration play to the end, or set the range by hand.'
      )
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Set the range by hand' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Record again to check' })).toBeNull();
    expect(slotTexts()).toEqual(['Recording 1done, 38 s', 'Recording 2optional, a check']);
    await user.click(screen.getByRole('button', { name: 'Record again' }));
    expect(await screen.findByRole('button', { name: 'Start recording' })).toBeEnabled();
    expect(slotTexts()).toEqual(['Recording 1needed', 'Recording 2optional, a check']);
    await recordOnce(user, 1);
    expect(await screen.findByRole('heading', { name: 'No complete demonstration found' })).toBeInTheDocument();
    expect(api.calls.filter(call => call.path.endsWith('reference-proposals')).map(call => call.body)).toEqual([
      { captureIds: ['cap-1'] },
      { captureIds: ['cap-2'] }
    ]);
  });

  it('manual_range_explains_the_cut_and_the_refusal', async () => {
    recordingApi()
      .on('GET /api/captures', [captureInfo('cap-old', { active: false, packets: 2571, endedAt: '2026-11-16T10:01:00.000Z' })])
      .on('POST /api/references', { status: 400, body: { code: 'no-timer-run' } });
    renderApp({ path: `/exercises/${EXERCISE_ID}/record` });
    const user = timedUser();
    await user.click(await screen.findByRole('button', { name: 'Set the range by hand' }));
    const form = screen.getByRole('form', { name: 'Manual range' });
    expect(within(form).getByText('GT7 Tutor keeps only the part of the range that holds the demonstration.')).toBeInTheDocument();
    await user.type(within(form).getByLabelText('First frame'), '420');
    await user.type(within(form).getByLabelText('Last frame'), '1310');
    await user.click(within(form).getByRole('button', { name: 'Create reference' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent(
      'This range does not hold the whole demonstration. Choose frames from before the start to after the end of the demonstration.'
    );
  });

  it('manual_range_labels_the_recording_and_names_the_busy_refusal', async () => {
    recordingApi()
      .on('GET /api/captures', [captureInfo('cap-old', { active: false, packets: 2571, endedAt: '2026-11-16T10:01:00.000Z' })])
      .on('POST /api/references', { status: 409, body: { code: 'busy' } });
    renderApp({ path: `/exercises/${EXERCISE_ID}/record` });
    const user = timedUser();
    await user.click(await screen.findByRole('button', { name: 'Set the range by hand' }));
    const form = screen.getByRole('form', { name: 'Manual range' });
    expect(within(form).getByLabelText('Recording')).toBeInTheDocument();
    await user.type(within(form).getByLabelText('First frame'), '420');
    await user.type(within(form).getByLabelText('Last frame'), '1310');
    await user.click(within(form).getByRole('button', { name: 'Create reference' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent('Another recording or training runs. Stop it first.');
  });

  it('manual_range_without_a_finished_recording_says_so', async () => {
    recordingApi().on('GET /api/captures', []);
    renderApp({ path: `/exercises/${EXERCISE_ID}/record` });
    const user = timedUser();
    await user.click(await screen.findByRole('button', { name: 'Set the range by hand' }));
    const form = screen.getByRole('form', { name: 'Manual range' });
    await user.type(within(form).getByLabelText('First frame'), '420');
    await user.type(within(form).getByLabelText('Last frame'), '1310');
    await user.click(within(form).getByRole('button', { name: 'Create reference' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent('This exercise has no finished recording.');
  });

  it('manual_range_is_a_text_link', async () => {
    recordingApi();
    renderApp({ path: `/exercises/${EXERCISE_ID}/record` });
    const hint = await screen.findByText('Experienced user?');
    const open = within(hint.closest('p')!).getByRole('button', { name: 'Set the range by hand' });
    expect(open).toHaveClass('text-link');
  });

  it('created_links_back_to_the_exercise_page', async () => {
    recordingApi();
    renderApp({ path: `/exercises/${EXERCISE_ID}/record` });
    const user = timedUser();
    await recordOnce(user, 1);
    await user.click(await screen.findByRole('button', { name: 'Use this as the reference' }));
    expect(await screen.findByRole('heading', { name: 'The reference is active' })).toBeInTheDocument();
    const drive = screen.getByRole('button', { name: 'Drive' });
    expect(drive).toHaveClass('stage-button', 'primary');
    expect(screen.queryByRole('link', { name: 'Back to the exercise' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Hear the cues' })).toHaveAttribute('href', `/exercises/${EXERCISE_ID}/cues`);
  });

  it('created_drive_arms_and_opens_the_stage', async () => {
    const api = recordingApi().on('POST /api/training/arm', { status: 201, body: { captureId: 'cap-9', exerciseId: EXERCISE_ID, referenceId: REFERENCE_ID } });
    renderApp({ path: `/exercises/${EXERCISE_ID}/record` });
    const user = timedUser();
    await recordOnce(user, 1);
    await user.click(await screen.findByRole('button', { name: 'Use this as the reference' }));
    await user.click(await screen.findByRole('button', { name: 'Drive' }));
    await waitFor(() => expect(window.location.pathname).toBe(`/exercises/${EXERCISE_ID}/drive`));
    expect(api.calls.find(call => call.path === '/api/training/arm')?.body).toEqual({ exerciseId: EXERCISE_ID });
  });

  it('check_that_does_not_match_asks_for_a_new_reference', async () => {
    recordingApi().on(`POST /api/references/${REFERENCE_ID}/check`, { matched: false, range: null, reference: reference() });
    renderApp({ path: `/exercises/${EXERCISE_ID}/record?check=${REFERENCE_ID}` });
    const user = timedUser();
    await recordOnce(user, 1);
    expect(await screen.findByText('The new recording does not match the reference. Record a new reference.')).toBeInTheDocument();
    expect(slotTexts()).toEqual(['Recording 1done, 38 s']);
  });

  it('phone_recording_hides_navigation', async () => {
    setViewportWidth(390);
    recordingApi();
    renderApp({ path: `/exercises/${EXERCISE_ID}/record` });
    const start = await screen.findByRole('button', { name: 'Start recording' });
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull();
    expect(screen.queryByRole('banner')).toBeNull();
    expect(screen.getByRole('link', { name: 'Close' })).toHaveAttribute('href', `/exercises/${EXERCISE_ID}`);
    const user = timedUser();
    await user.click(start);
    expect(await screen.findByRole('button', { name: 'Stop recording 1' })).toBeInTheDocument();
  });

  it('phone_shows_the_found_demonstration_and_records_the_check', async () => {
    setViewportWidth(390);
    recordingApi();
    renderApp({ path: `/exercises/${EXERCISE_ID}/record` });
    const user = timedUser();
    await recordOnce(user, 1);
    expect(await screen.findByRole('heading', { name: 'The demonstration is found' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start recording' })).toBeNull();
    expect(slotTexts()).toEqual(['Recording 1done, 38 s', 'Recording 2optional, a check']);
    await user.click(screen.getByRole('button', { name: 'Record again to check' }));
    await recordOnce(user, 2);
    expect(await screen.findByText('The same part repeats in both recordings.')).toBeInTheDocument();
  });

  it('record_stops_the_training_then_records', async () => {
    const api = recordingApi().on('POST /api/training/disarm', { status: 201, body: { ok: true } });
    const view = renderApp({ path: `/exercises/${EXERCISE_ID}/record` });
    await sendLiveState(view, { mode: 'armed', exerciseId: EXERCISE_ID });
    const user = timedUser();
    expect(await screen.findByText(`The training of ${exercise().name} is on. A recording needs it off.`)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start recording' })).toBeNull();
    await user.click(await screen.findByRole('button', { name: 'Stop the training and record' }));
    await waitFor(() => expect(api.called('POST /api/captures')).toBe(true));
    expect(api.calls.filter(call => call.method === 'POST').map(call => `${call.method} ${call.path}`).slice(0, 2)).toEqual(['POST /api/training/disarm', 'POST /api/captures']);
  });

  it('record_does_not_start_when_the_stop_fails', async () => {
    const api = recordingApi().on('POST /api/training/disarm', { status: 500, body: { code: 'server-error' } });
    const view = renderApp({ path: `/exercises/${EXERCISE_ID}/record` });
    await sendLiveState(view, { mode: 'finished', exerciseId: EXERCISE_ID });
    const user = timedUser();
    await user.click(await screen.findByRole('button', { name: 'Stop the training and record' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(api.called('POST /api/captures')).toBe(false);
  });

  it('record_waits_while_an_attempt_runs', async () => {
    recordingApi();
    const view = renderApp({ path: `/exercises/${EXERCISE_ID}/record` });
    await sendLiveState(view, { mode: 'driving', exerciseId: EXERCISE_ID, attemptNumber: 10 });
    expect(await screen.findByText('Attempt 10 runs. Finish it or stop the training first.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start recording' })).toBeDisabled();
  });
});
