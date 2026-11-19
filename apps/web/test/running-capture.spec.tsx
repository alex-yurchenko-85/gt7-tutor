import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { exerciseApi, rememberExercise } from './fixtures.ts';
import { liveState, renderApp, setViewportWidth } from './support.tsx';

describe('running capture', () => {
  it('running_recording_can_be_stopped_from_any_view', async () => {
    setViewportWidth(390);
    rememberExercise();
    const api = exerciseApi()
      .on('GET /api/captures', [
        {
          id: 'cap-7',
          exerciseId: 'e0000000-0000-4000-8000-000000000001',
          purpose: 'demo',
          startedAt: '2026-11-16T10:00:00.000Z',
          endedAt: null,
          packets: 0,
          complete: true,
          errorReason: null,
          startCueMonoMs: 5000,
          active: true
        }
      ])
      .on('POST /api/captures/cap-7/stop', { status: 201, body: { ok: true } })
      .install();
    const view = renderApp({ path: '/' });
    await waitFor(() => view.sockets.latest);
    act(() => {
      view.sockets.latest.open();
      view.sockets.latest.receive({ type: 'state', state: liveState({ mode: 'capturing', exerciseId: 'e0000000-0000-4000-8000-000000000001', connection: 'connected' }) });
    });
    expect(await screen.findByText(/A recording is running/)).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Stop recording' }));
    await waitFor(() => expect(api.called('POST /api/captures/cap-7/stop')).toBe(true));
  });
});
