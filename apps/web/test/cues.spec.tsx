import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { Exercise } from '@gt7/contracts';
import { CORNERS, CUES, exercise, exerciseApi } from './fixtures.ts';
import { renderApp, setViewportWidth } from './support.tsx';

describe('cue list', () => {
  it('cue_list_rows_show_distance_phrase_and_recurring_difference', async () => {
    setViewportWidth(1280);
    exerciseApi()
      .on('GET /api/exercises/e0000000-0000-4000-8000-000000000001/recurring', [
        { kind: 'brake-early', eventKey: 'brake@332', sM: 332, size: 15, unit: 'm', count: 6, of: 8, medianSize: 14 }
      ])
      .install();
    renderApp({ path: '/exercises/e0000000-0000-4000-8000-000000000001/cues' });
    const rows = await screen.findAllByRole('listitem', { name: /^Cue \d/ });
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent('332 m');
    expect(rows[0]).toHaveTextContent('Hard brake. Eighty five');
    expect(rows[0]).toHaveTextContent('Braked early in 6 of 8 attempts, median 14 m');
    expect(rows[1]).toHaveTextContent('Full throttle');
    expect(rows[1]).not.toHaveTextContent('attempts');
    expect(screen.getByText(/Yellow rows mark places/)).toBeInTheDocument();
    expect(screen.queryByText(/mistake/i)).toBeNull();
  });

  it('cue_list_counts_cues_and_turns_found', async () => {
    setViewportWidth(1280);
    exerciseApi().install();
    renderApp({ path: '/exercises/e0000000-0000-4000-8000-000000000001/cues' });
    expect(await screen.findByText(/^3 cues and 3 turns found in the reference\./)).toBeInTheDocument();
  });

  it('cue_list_says_one_turn_for_a_single_turn', async () => {
    setViewportWidth(1280);
    exerciseApi()
      .on('GET /api/references/ref-demo/corners', CORNERS.slice(0, 1))
      .on('GET /api/references/ref-demo/cues', CUES.slice(0, 1))
      .install();
    renderApp({ path: '/exercises/e0000000-0000-4000-8000-000000000001/cues' });
    expect(await screen.findByText(/^1 cue and 1 turn found in the reference\./)).toBeInTheDocument();
  });

  it('mute_toggles_and_persists', async () => {
    setViewportWidth(1280);
    let current: Exercise = exercise({ mutedCues: ['ease-off@600'] });
    const api = exerciseApi(current)
      .on('GET /api/exercises/e0000000-0000-4000-8000-000000000001', () => current)
      .on('PATCH /api/exercises/e0000000-0000-4000-8000-000000000001', (body: unknown) => {
        current = { ...current, mutedCues: (body as { mutedCues: string[] }).mutedCues };
        return current;
      })
      .install();
    const view = renderApp({ path: '/exercises/e0000000-0000-4000-8000-000000000001/cues' });
    const user = userEvent.setup();
    const row = await screen.findByRole('listitem', { name: 'Cue 2' });
    await user.click(within(row).getByRole('button', { name: 'Mute' }));
    await waitFor(() => expect(api.calls.find(call => call.method === 'PATCH')?.body).toEqual({ mutedCues: ['ease-off@600', 'throttle@491'] }));
    expect(within(row).getByRole('button', { name: 'Unmute' })).toHaveAttribute('aria-pressed', 'true');
    expect(row).toHaveTextContent('Muted. The voice does not say this cue.');
    view.unmount();

    renderApp({ path: '/exercises/e0000000-0000-4000-8000-000000000001/cues' });
    const again = await screen.findByRole('listitem', { name: 'Cue 2' });
    expect(within(again).getByRole('button', { name: 'Unmute' })).toBeInTheDocument();
  });

  function patchingApi(start: Exercise = exercise()) {
    let current = start;
    return exerciseApi(current)
      .on('GET /api/exercises/e0000000-0000-4000-8000-000000000001', () => current)
      .on('PATCH /api/exercises/e0000000-0000-4000-8000-000000000001', (body: unknown) => {
        current = { ...current, ...(body as Partial<Exercise>) };
        return current;
      });
  }

  it('cue_list_has_phrase_and_target_columns', async () => {
    setViewportWidth(1280);
    exerciseApi().install();
    renderApp({ path: '/exercises/e0000000-0000-4000-8000-000000000001/cues' });
    const row = await screen.findByRole('listitem', { name: 'Cue 1' });
    expect(within(row).getByText('Hard brake. Eighty five')).toBeInTheDocument();
    expect(within(row).getByLabelText('Target speed')).toHaveTextContent('85 km/h');
    expect(row).toHaveTextContent('Big stop first');
    const throttle = screen.getByRole('listitem', { name: 'Cue 2' });
    expect(within(throttle).getByLabelText('Target speed')).toHaveTextContent('95 km/h');
    expect(within(screen.getByRole('listitem', { name: 'Cue 3' })).getByLabelText('Target speed')).toHaveTextContent('–');
  });

  it('cue_list_has_speak_targets_switch', async () => {
    setViewportWidth(1280);
    const api = patchingApi().install();
    renderApp({ path: '/exercises/e0000000-0000-4000-8000-000000000001/cues' });
    const toggle = await screen.findByRole('switch', { name: 'Speak target speeds' });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    await userEvent.setup().click(toggle);
    await waitFor(() => expect(api.calls.find(call => call.method === 'PATCH')?.body).toEqual({ speakTargets: false }));
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'false'));
  });

  it('side_cue_distance_control_saves_the_value', async () => {
    setViewportWidth(1280);
    const api = patchingApi().install();
    renderApp({ path: '/exercises/e0000000-0000-4000-8000-000000000001/cues' });
    const control = await screen.findByRole('combobox', { name: 'Side cue distance' });
    expect(within(control).getAllByRole('option').map(option => option.textContent)).toEqual(['Off', '0.5 m', '1 m', '1.5 m', '2 m', '2.5 m', '3 m']);
    expect(control).toHaveDisplayValue('2 m');
    await userEvent.setup().selectOptions(control, '1 m');
    await waitFor(() => expect(api.calls.find(call => call.method === 'PATCH')?.body).toEqual({ sideCueDistanceM: 1 }));
    await waitFor(() => expect(control).toHaveDisplayValue('1 m'));
  });

  it('side_cue_distance_off_is_shown_as_off', async () => {
    setViewportWidth(1280);
    const api = patchingApi(exercise({ sideCueDistanceM: null })).install();
    renderApp({ path: '/exercises/e0000000-0000-4000-8000-000000000001/cues' });
    const control = await screen.findByRole('combobox', { name: 'Side cue distance' });
    expect(control).toHaveDisplayValue('Off');
    expect(screen.getByText('The voice does not say “Keep left” or “Keep right”.')).toBeInTheDocument();
    const user = userEvent.setup();
    await user.selectOptions(control, '1.5 m');
    await waitFor(() => expect(control).toHaveDisplayValue('1.5 m'));
    await user.selectOptions(control, 'Off');
    await waitFor(() => expect(api.calls.filter(call => call.method === 'PATCH').at(-1)?.body).toEqual({ sideCueDistanceM: null }));
    await waitFor(() => expect(control).toHaveDisplayValue('Off'));
  });

  it('cue_offset_slider_per_cue', async () => {
    setViewportWidth(1280);
    const api = patchingApi(exercise({ cueOffsetsMs: { 'brake@332': 200 } })).install();
    renderApp({ path: '/exercises/e0000000-0000-4000-8000-000000000001/cues' });
    const row = await screen.findByRole('listitem', { name: 'Cue 1' });
    const slider = within(row).getByRole('slider', { name: 'Move cue 1 earlier or later' });
    expect(slider).toHaveAttribute('aria-valuetext', '0.2 s earlier');
    expect(within(row).getByRole('status', { name: 'Timing of cue 1' })).toHaveTextContent('0.2 s earlier');
    fireEvent.change(slider, { target: { value: '-300' } });
    expect(within(row).getByRole('status', { name: 'Timing of cue 1' })).toHaveTextContent('0.3 s earlier');
    await waitFor(() => expect(api.calls.filter(call => call.method === 'PATCH').at(-1)?.body).toEqual({ cueOffsetsMs: { 'brake@332': 300 } }));

    const other = screen.getByRole('listitem', { name: 'Cue 2' });
    const second = within(other).getByRole('slider', { name: 'Move cue 2 earlier or later' });
    expect(within(other).getByRole('status', { name: 'Timing of cue 2' })).toHaveTextContent('On time');
    fireEvent.change(second, { target: { value: '100' } });
    fireEvent.change(second, { target: { value: '200' } });
    await waitFor(() =>
      expect(api.calls.filter(call => call.method === 'PATCH').at(-1)?.body).toEqual({ cueOffsetsMs: { 'brake@332': 300, 'throttle@491': -200 } })
    );
    expect(api.calls.filter(call => call.method === 'PATCH')).toHaveLength(2);
    expect(within(other).getByRole('status', { name: 'Timing of cue 2' })).toHaveTextContent('0.2 s later');
  });

  it('cue_offset_is_saved_when_leaving_the_view_at_once', async () => {
    setViewportWidth(1280);
    const api = patchingApi().install();
    const view = renderApp({ path: '/exercises/e0000000-0000-4000-8000-000000000001/cues' });
    const slider = await screen.findByRole('slider', { name: 'Move cue 1 earlier or later' });
    fireEvent.change(slider, { target: { value: '-300' } });
    view.unmount();
    await waitFor(() => expect(api.calls.filter(call => call.method === 'PATCH').at(-1)?.body).toEqual({ cueOffsetsMs: { 'brake@332': 300 } }));
  });

  it('a_mute_response_does_not_reset_a_moved_slider', async () => {
    setViewportWidth(1280);
    const stale = exercise();
    exerciseApi(stale)
      .on('PATCH /api/exercises/e0000000-0000-4000-8000-000000000001', (body: unknown) => ({ ...stale, ...(body as Partial<Exercise>) }))
      .install();
    renderApp({ path: '/exercises/e0000000-0000-4000-8000-000000000001/cues' });
    const row = await screen.findByRole('listitem', { name: 'Cue 1' });
    fireEvent.change(within(row).getByRole('slider', { name: 'Move cue 1 earlier or later' }), { target: { value: '-300' } });
    await userEvent.setup().click(within(screen.getByRole('listitem', { name: 'Cue 2' })).getByRole('button', { name: 'Mute' }));
    await screen.findByRole('button', { name: 'Unmute' });
    expect(within(row).getByRole('status', { name: 'Timing of cue 1' })).toHaveTextContent('0.3 s earlier');
  });

  it('cue_offset_slider_covers_one_second_earlier_to_half_a_second_later', async () => {
    setViewportWidth(1280);
    patchingApi().install();
    renderApp({ path: '/exercises/e0000000-0000-4000-8000-000000000001/cues' });
    const slider = await screen.findByRole('slider', { name: 'Move cue 1 earlier or later' });
    expect(slider).toHaveAttribute('min', '-1000');
    expect(slider).toHaveAttribute('max', '500');
    expect(slider).toHaveAttribute('step', '100');
    expect(slider).toHaveValue('0');
  });

  it('cue_list_shows_brake_reaction', async () => {
    setViewportWidth(1280);
    exerciseApi()
      .on('GET /api/exercises/e0000000-0000-4000-8000-000000000001/reactions', [{ eventKey: 'brake@332', medianMs: 690, count: 3 }])
      .install();
    renderApp({ path: '/exercises/e0000000-0000-4000-8000-000000000001/cues' });
    const row = await screen.findByRole('listitem', { name: 'Cue 1' });
    await waitFor(() => expect(row).toHaveTextContent('You start to brake 0.7 s after the cue here (3 attempts)'));
    expect(screen.getByRole('listitem', { name: 'Cue 2' })).not.toHaveTextContent('You start to brake');
  });

  it('cue_list_shows_braking_before_the_cue', async () => {
    setViewportWidth(1280);
    exerciseApi()
      .on('GET /api/exercises/e0000000-0000-4000-8000-000000000001/reactions', [{ eventKey: 'brake@332', medianMs: -420, count: 1 }])
      .install();
    renderApp({ path: '/exercises/e0000000-0000-4000-8000-000000000001/cues' });
    const row = await screen.findByRole('listitem', { name: 'Cue 1' });
    await waitFor(() => expect(row).toHaveTextContent('You start to brake 0.4 s before the cue here (1 attempt)'));
  });

  it('cue_list_without_attempts_shows_no_reaction', async () => {
    setViewportWidth(1280);
    exerciseApi().install();
    renderApp({ path: '/exercises/e0000000-0000-4000-8000-000000000001/cues' });
    await screen.findByRole('listitem', { name: 'Cue 1' });
    expect(screen.queryByText(/You start to brake/)).not.toBeInTheDocument();
  });

  it('cue_list_shows_corner_rows', async () => {
    setViewportWidth(1280);
    exerciseApi().install();
    renderApp({ path: '/exercises/e0000000-0000-4000-8000-000000000001/cues' });
    const turns = await screen.findAllByRole('listitem', { name: /^Turn \d/ });
    expect(turns.map(turn => turn.getAttribute('aria-label'))).toEqual(['Turn 1', 'Turn 2', 'Turn 3']);
    expect(turns[0]).toHaveTextContent('Turn-in 461 m');
    expect(turns[0]).toHaveTextContent('Apex 519 m');
    expect(turns[0]).toHaveTextContent('Radius 43 m');
    expect(turns[0]).toHaveTextContent('89 km/h at the apex');
    const order = screen.getAllByRole('listitem').map(item => item.getAttribute('aria-label'));
    expect(order).toEqual(['Cue 1', 'Turn 1', 'Cue 2', 'Cue 3', 'Turn 2', 'Turn 3']);
    expect(CUES.map(cue => cue.sM)).toEqual([332, 491, 600]);
  });

  it('maps_mark_turn_in_and_apex', async () => {
    setViewportWidth(1280);
    exerciseApi().install();
    renderApp({ path: '/exercises/e0000000-0000-4000-8000-000000000001/cues' });
    await screen.findByRole('listitem', { name: 'Turn 1' });
    const apexes = [...document.querySelectorAll('.track-map .track-mark.apex')];
    expect(apexes.map(mark => mark.textContent)).toEqual(['Apex of turn 1T1', 'Apex of turn 2T2', 'Apex of turn 3T3']);
    expect(document.querySelectorAll('.track-map .track-mark.turn-in line')).toHaveLength(3);
  });
});

