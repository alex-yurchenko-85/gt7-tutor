import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CaptureInfo, ReferenceProposal } from '@gt7/contracts';
import { EXERCISE_ID, exercise, exerciseApi, reference, REFERENCE_ID } from './fixtures.ts';
import { renderApp, setViewportWidth, type ApiStub } from './support.tsx';

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

function recordingApi(): ApiStub {
  let next = 0;
  const api = exerciseApi(exercise({ step: 1, activeReferenceId: null }))
    .on('POST /api/captures', () => ({ status: 201, body: captureInfo(`cap-${++next}`) }))
    .on('POST /api/exercises/ex-1/reference-proposals', PROPOSALS)
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
    await user.click(screen.getByRole('button', { name: 'Stop recording' }));
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
    renderApp({ path: '/exercises/ex-1/record' });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await recordAll(user, 3, [5, 10, 15]);
    const starts = api.calls.filter(call => call.method === 'POST' && call.path === '/api/captures').map(call => call.body);
    expect(starts).toEqual([5, 10, 15].map(startAfterS => ({ exerciseId: EXERCISE_ID, purpose: 'demo', startAfterS })));
    await waitFor(() => expect(api.called('POST /api/exercises/ex-1/reference-proposals')).toBe(true));
    expect(api.calls.find(call => call.path.endsWith('reference-proposals'))?.body).toEqual({ captureIds: ['cap-1', 'cap-2', 'cap-3'] });
  });

  it('proposal_shows_candidates_and_needs_confirmation', async () => {
    setViewportWidth(1280);
    const api = recordingApi();
    renderApp({ path: '/exercises/ex-1/record' });
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
      captureInfo('cap-other', { active: false, exerciseId: 'ex-2' })
    ]);
    renderApp({ path: '/exercises/ex-1/record' });
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
      .on('GET /api/exercises/ex-1/references', [reference({ needsCheck: true })])
      .on(`POST /api/references/${REFERENCE_ID}/check`, () =>
        ++calls === 1
          ? { status: 500, body: { statusCode: 500, message: 'Internal server error' } }
          : { status: 201, body: { matched: true, range: { first: 10, last: 1555 }, reference: reference() } }
      );
    renderApp({ path: `/exercises/ex-1/record?check=${REFERENCE_ID}` });
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
    renderApp({ path: '/exercises/ex-1/record' });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    expect(await screen.findByRole('timer')).toHaveTextContent('START');
    await user.click(screen.getByRole('button', { name: 'Stop recording' }));
    await waitFor(() => expect(api.called('POST /api/captures/cap-running/stop')).toBe(true));
  });

  it('needs_check_badge_starts_one_recording_check', async () => {
    setViewportWidth(1280);
    const api = recordingApi().on('GET /api/exercises/ex-1/references', [reference({ needsCheck: true, gameVersion: '1.60' })]);
    renderApp({ path: '/exercises/ex-1/references' });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    expect(await screen.findByText('Needs a check')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Check with one recording' }));
    expect(await screen.findByRole('heading', { name: 'Check the reference' })).toBeInTheDocument();
    await recordAll(user, 1, [5]);
    await waitFor(() => expect(api.calls.find(call => call.path === `/api/references/${REFERENCE_ID}/check`)?.body).toEqual({ captureId: 'cap-1' }));
    expect(await screen.findByText(/The new recording matches the reference/)).toBeInTheDocument();
  });
});
