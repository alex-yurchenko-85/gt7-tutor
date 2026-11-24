import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { CuePreview, Exercise } from '@gt7/contracts';
import { CORNERS, CUES, NO_DROP_PREVIEW, REFERENCE_ID, exercise, exerciseApi, EXERCISE_ID } from './fixtures.ts';
import { el, els, findEl, findEls, findSection, mapMark, playerRig, renderApp, setViewportWidth, iconButton, findIconButton } from './support.tsx';

function sliderOf(row: HTMLElement): HTMLElement {
  if (!row.querySelector('input[type="range"]')) fireEvent.click(el('button.cue-name', row));
  return el('input[type="range"]', row);
}

describe('cues without a reference', () => {
  it('panel_has_the_text_and_the_record_button_one_padding_apart', async () => {
    exerciseApi(exercise({ activeReferenceId: null, referenceCount: 0 })).install();
    renderApp({ path: `/exercises/${EXERCISE_ID}/cues` });
    const link = await screen.findByRole('link', { name: 'Record the reference' });
    const panel = link.closest('.panel')!;
    expect(panel).toHaveClass('cues-start');
    expect(panel.querySelector('p')).toHaveTextContent('The cues come from the reference. This exercise has no reference yet.');
  });
});

describe('cue list', () => {
  it('cue_list_rows_show_distance_phrase_and_recurring_difference', async () => {
    exerciseApi()
      .on(`GET /api/exercises/${EXERCISE_ID}/recurring`, [
        { kind: 'brake-early', eventKey: 'brake@332', sM: 332, size: 15, unit: 'm', count: 6, of: 8, medianSize: 14 }
      ])
      .install();
    renderApp({ path: `/exercises/${EXERCISE_ID}/cues` });
    const rows = await findEls('[data-cue]');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent('332 m');
    expect(rows[0]).toHaveTextContent('Hard brake. Eighty five');
    expect(rows[0]).toHaveTextContent('Braked early in 6 of 8 attempts, median 14 m');
    expect(rows[1]).toHaveTextContent('Full throttle');
    expect(rows[1]).not.toHaveTextContent('attempts');
    expect(screen.getByText(/Yellow rows mark places/)).toBeInTheDocument();
    expect(screen.queryByText(/mistake/i)).toBeNull();
  });

  it('cue_intro_keeps_only_the_counts_and_the_muted_cue_rule', async () => {
    exerciseApi().install();
    renderApp({ path: `/exercises/${EXERCISE_ID}/cues` });
    expect(await screen.findByText('3 cues and 3 turns found in the reference. A muted cue is not spoken, and its decision is still recorded.')).toBeInTheDocument();
    expect(screen.queryByText(/Select a cue to find it|Distance is from the section start|Timing moves one cue/)).toBeNull();
  });

  it('cue_list_counts_cues_and_turns_found', async () => {
    exerciseApi().install();
    renderApp({ path: `/exercises/${EXERCISE_ID}/cues` });
    expect(await screen.findByText(/^3 cues and 3 turns found in the reference\./)).toBeInTheDocument();
  });

  it('cue_list_says_one_turn_for_a_single_turn', async () => {
    exerciseApi()
      .on('GET /api/references/ref-demo/corners', CORNERS.slice(0, 1))
      .on('GET /api/references/ref-demo/cues', CUES.slice(0, 1))
      .install();
    renderApp({ path: `/exercises/${EXERCISE_ID}/cues` });
    expect(await screen.findByText(/^1 cue and 1 turn found in the reference\./)).toBeInTheDocument();
  });

  it('mute_toggles_and_persists', async () => {
    let current: Exercise = exercise({ mutedCues: ['ease-off@600'] });
    const api = exerciseApi(current)
      .on(`GET /api/exercises/${EXERCISE_ID}`, () => current)
      .on(`PATCH /api/exercises/${EXERCISE_ID}`, (body: unknown) => {
        current = { ...current, mutedCues: (body as { mutedCues: string[] }).mutedCues };
        return current;
      })
      .install();
    const view = renderApp({ path: `/exercises/${EXERCISE_ID}/cues` });
    const user = userEvent.setup();
    const row = await findEl('[data-cue="2"]');
    expect(iconButton('Hear Full throttle', row).querySelector('[data-icon="play"]')).not.toBeNull();
    const mute = iconButton('Mute cue 2', row);
    expect(mute).toHaveAttribute('aria-pressed', 'false');
    expect(mute.querySelector('[data-icon="speaker"]')).not.toBeNull();
    expect(row).not.toHaveClass('off');
    await user.click(mute);
    await waitFor(() => expect(api.calls.find(call => call.method === 'PATCH')?.body).toEqual({ mutedCues: ['ease-off@600', 'throttle@491'] }));
    const unmute = iconButton('Unmute cue 2', row);
    expect(unmute).toHaveAttribute('aria-pressed', 'true');
    expect(unmute.querySelector('[data-icon="speaker-off"]')).not.toBeNull();
    expect(row).toHaveClass('off');
    expect(within(row).queryByText('Muted')).toBeNull();
    expect(row).not.toHaveTextContent('The voice does not say this cue');
    expect(within(row).queryByRole('slider')).toBeNull();
    view.unmount();

    renderApp({ path: `/exercises/${EXERCISE_ID}/cues` });
    const again = await findEl('[data-cue="2"]');
    expect(iconButton('Unmute cue 2', again)).toBeInTheDocument();
  });

  function patchingApi(start: Exercise = exercise()) {
    let current = start;
    return exerciseApi(current)
      .on(`GET /api/exercises/${EXERCISE_ID}`, () => current)
      .on(`PATCH /api/exercises/${EXERCISE_ID}`, (body: unknown) => {
        current = { ...current, ...(body as Partial<Exercise>) };
        return current;
      });
  }

  it('cue_list_has_phrase_and_target_columns', async () => {
    exerciseApi().install();
    renderApp({ path: `/exercises/${EXERCISE_ID}/cues` });
    const row = await findEl('[data-cue="1"]');
    const throttle = el('[data-cue="2"]');
    expect(within(row).getByText('Hard brake. Eighty five')).toBeInTheDocument();
    expect(el('.target', row)).toHaveTextContent('85 km/h');
    expect(row).toHaveTextContent('Big brake ahead first');
    expect(screen.getByText(/the voice says “Closer to apex” only when you run wide/)).toBeInTheDocument();
    expect(el('.target', row)).toHaveTextContent('lowest speed');
    expect(el('.target', throttle)).not.toHaveTextContent('lowest speed');
    expect(el('.target', throttle)).toHaveTextContent('95 km/h');
    expect(el('.target', el('[data-cue="3"]'))).toHaveTextContent('–');
  });

  it('cue_list_has_speak_targets_switch', async () => {
    const api = patchingApi().install();
    renderApp({ path: `/exercises/${EXERCISE_ID}/cues` });
    const toggle = await screen.findByRole('switch', { name: 'Speak target speeds' });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('After a brake phrase, the voice says the lowest speed of the reference in that place, for example “Hard brake. Eighty five”.')).toBeInTheDocument();
    await userEvent.setup().click(toggle);
    await waitFor(() => expect(api.calls.find(call => call.method === 'PATCH')?.body).toEqual({ speakTargets: false }));
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'false'));
    const first = el('[data-cue="1"]');
    expect(within(first).getByText('Hard brake')).toBeInTheDocument();
    expect(iconButton('Hear Hard brake', first)).toBeInTheDocument();
  });

  it('side_cue_distance_control_saves_the_value', async () => {
    const api = patchingApi().install();
    renderApp({ path: `/exercises/${EXERCISE_ID}/cues` });
    const control = await screen.findByRole('combobox', { name: 'Side cue distance' });
    const name = screen.getByText('Side cue distance', { selector: 'label' });
    expect(control.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(control.parentElement).toBe(name.parentElement);
    expect(screen.queryByRole('heading', { name: 'What the voice will say' })).toBeNull();
    expect(within(control).getAllByRole('option').map(option => option.textContent)).toEqual(['Off', '0.5 m', '1 m', '1.5 m', '2 m', '2.5 m', '3 m']);
    expect(control).toHaveDisplayValue('2 m');
    expect(screen.getByText('The voice says “More left” or “More right” when the car stays more than 2 m from the reference line.')).toBeInTheDocument();
    await userEvent.setup().selectOptions(control, '1 m');
    await waitFor(() => expect(api.calls.find(call => call.method === 'PATCH')?.body).toEqual({ sideCueDistanceM: 1 }));
    await waitFor(() => expect(control).toHaveDisplayValue('1 m'));
  });

  it('side_cue_distance_off_is_shown_as_off', async () => {
    const api = patchingApi(exercise({ sideCueDistanceM: null })).install();
    renderApp({ path: `/exercises/${EXERCISE_ID}/cues` });
    const control = await screen.findByRole('combobox', { name: 'Side cue distance' });
    expect(control).toHaveDisplayValue('Off');
    expect(screen.getByText('The voice does not say “More left” or “More right”.')).toBeInTheDocument();
    const user = userEvent.setup();
    await user.selectOptions(control, '1.5 m');
    await waitFor(() => expect(control).toHaveDisplayValue('1.5 m'));
    await user.selectOptions(control, 'Off');
    await waitFor(() => expect(api.calls.filter(call => call.method === 'PATCH').at(-1)?.body).toEqual({ sideCueDistanceM: null }));
    await waitFor(() => expect(control).toHaveDisplayValue('Off'));
  });

  it('cue_offset_slider_per_cue', async () => {
    const api = patchingApi(exercise({ cueOffsetsMs: { 'brake@332': 200 } })).install();
    renderApp({ path: `/exercises/${EXERCISE_ID}/cues` });
    const row = await findEl('[data-cue="1"]');
    const slider = sliderOf(row);
    expect(el('output', row)).toHaveTextContent('0.2 s earlier');
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const saveDelay = () => act(() => vi.advanceTimersByTime(500));
    fireEvent.change(slider, { target: { value: '-300' } });
    saveDelay();
    expect(el('output', row)).toHaveTextContent('0.3 s earlier');
    await waitFor(() => expect(api.calls.filter(call => call.method === 'PATCH').at(-1)?.body).toEqual({ cueOffsetsMs: { 'brake@332': 300 } }));

    const other = el('[data-cue="2"]');
    const second = sliderOf(other);
    expect(el('output', other)).toHaveTextContent('On time');
    fireEvent.change(second, { target: { value: '100' } });
    fireEvent.change(second, { target: { value: '200' } });
    saveDelay();
    await waitFor(() =>
      expect(api.calls.filter(call => call.method === 'PATCH').at(-1)?.body).toEqual({ cueOffsetsMs: { 'brake@332': 300, 'throttle@491': -200 } })
    );
    expect(api.calls.filter(call => call.method === 'PATCH')).toHaveLength(2);
    expect(el('output', other)).toHaveTextContent('0.2 s later');
  });

  it('only_the_open_row_shows_the_timing_slider', async () => {
    patchingApi().install();
    renderApp({ path: `/exercises/${EXERCISE_ID}/cues` });
    const first = await findEl('[data-cue="1"]');
    const second = el('[data-cue="2"]');
    expect(els('input[type="range"]')).toHaveLength(0);
    const name = el('button.cue-name', first);
    expect(name).toHaveTextContent('Hard brake. Eighty five');
    expect(name).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(name);
    expect(name).toHaveAttribute('aria-expanded', 'true');
    expect(el('input[type="range"]', first)).toBeInTheDocument();
    expect(first).toHaveClass('open');
    fireEvent.click(el('button.cue-name', second));
    expect(first.querySelector('input[type="range"]')).toBeNull();
    expect(el('input[type="range"]', second)).toBeInTheDocument();
    fireEvent.click(el('button.cue-name', second));
    expect(els('input[type="range"]')).toHaveLength(0);
  });

  it('a_closed_row_shows_a_moved_timing_as_a_chip', async () => {
    patchingApi(exercise({ cueOffsetsMs: { 'brake@332': 500 } })).install();
    renderApp({ path: `/exercises/${EXERCISE_ID}/cues` });
    const first = await findEl('[data-cue="1"]');
    expect(el('.offset-chip', first)).toHaveTextContent('0.5 s earlier');
    expect(el('[data-cue="2"]').querySelector('.offset-chip')).toBeNull();
    fireEvent.click(el('button.cue-name', first));
    expect(first.querySelector('.offset-chip')).toBeNull();
    expect(el('output', first)).toHaveTextContent('0.5 s earlier');
  });

  it('cue_offset_is_saved_when_leaving_the_view_at_once', async () => {
    const api = patchingApi().install();
    const view = renderApp({ path: `/exercises/${EXERCISE_ID}/cues` });
    const slider = sliderOf(await findEl('[data-cue="1"]'));
    fireEvent.change(slider, { target: { value: '-300' } });
    view.unmount();
    await waitFor(() => expect(api.calls.filter(call => call.method === 'PATCH').at(-1)?.body).toEqual({ cueOffsetsMs: { 'brake@332': 300 } }));
  });

  it('a_mute_response_does_not_reset_a_moved_slider', async () => {
    const stale = exercise();
    exerciseApi(stale)
      .on(`PATCH /api/exercises/${EXERCISE_ID}`, (body: unknown) => ({ ...stale, ...(body as Partial<Exercise>) }))
      .install();
    renderApp({ path: `/exercises/${EXERCISE_ID}/cues` });
    const row = await findEl('[data-cue="1"]');
    fireEvent.change(sliderOf(row), { target: { value: '-300' } });
    const second = el('[data-cue="2"]');
    await userEvent.setup().click(iconButton('Mute cue 2', second));
    await findIconButton('Unmute cue 2', second);
    expect(el('output', row)).toHaveTextContent('0.3 s earlier');
  });

  it('cue_offset_slider_covers_one_second_earlier_to_half_a_second_later', async () => {
    patchingApi().install();
    renderApp({ path: `/exercises/${EXERCISE_ID}/cues` });
    const slider = sliderOf(await findEl('[data-cue="1"]'));
    expect(slider).toHaveAttribute('min', '-1000');
    expect(slider).toHaveAttribute('max', '500');
    expect(slider).toHaveAttribute('step', '100');
    expect(slider).toHaveValue('0');
  });

  it('cue_list_shows_brake_reaction', async () => {
    exerciseApi()
      .on(`GET /api/exercises/${EXERCISE_ID}/reactions`, [{ eventKey: 'brake@332', medianMs: 690, count: 3 }])
      .install();
    renderApp({ path: `/exercises/${EXERCISE_ID}/cues` });
    const row = await findEl('[data-cue="1"]');
    await waitFor(() => expect(row).toHaveTextContent('You start to brake 0.7 s after the cue here (3 attempts)'));
    expect(el('[data-cue="2"]')).not.toHaveTextContent('You start to brake');
  });

  it('cue_list_shows_braking_before_the_cue', async () => {
    exerciseApi()
      .on(`GET /api/exercises/${EXERCISE_ID}/reactions`, [{ eventKey: 'brake@332', medianMs: -420, count: 1 }])
      .install();
    renderApp({ path: `/exercises/${EXERCISE_ID}/cues` });
    const row = await findEl('[data-cue="1"]');
    await waitFor(() => expect(row).toHaveTextContent('You start to brake 0.4 s before the cue here (1 attempt)'));
  });

  it('cue_list_without_attempts_shows_no_reaction', async () => {
    exerciseApi().install();
    renderApp({ path: `/exercises/${EXERCISE_ID}/cues` });
    await findEl('[data-cue="1"]');
    expect(screen.queryByText(/You start to brake/)).not.toBeInTheDocument();
  });

  it('turn_row_says_how_the_reference_brakes', async () => {
    const plan = { brakeToSM: 268, brakeAtTurnIn: 0.35, lowSpeedSM: 280, lowSpeedMps: 18, lowSpeedAtApex: true };
    exerciseApi()
      .on('GET /api/references/ref-demo/corners', [
        { ...CORNERS[0]!, apexSM: 277, ...plan },
        { ...CORNERS[1]!, apexSM: 277, ...plan, lowSpeedSM: 265, lowSpeedAtApex: false },
        { ...CORNERS[2]!, apexSM: 276.7, ...plan, lowSpeedSM: 288, lowSpeedAtApex: false },
        { ...CORNERS[2]!, number: 4 }
      ])
      .install();
    renderApp({ path: `/exercises/${EXERCISE_ID}/cues` });
    await findEl('[data-turn="4"]');
    const line = (turn: number) => el(`[data-turn="${turn}"]`).querySelector('.brake-plan')?.textContent ?? null;
    expect(line(1)).toBe('Brake to 268 m, 35 % at the turn-in. Lowest speed at the apex.');
    expect(line(2)).toBe('Brake to 268 m, 35 % at the turn-in. Lowest speed 12 m before the apex.');
    expect(line(3)).toBe('Brake to 268 m, 35 % at the turn-in. Lowest speed 12 m after the apex.');
    expect(line(4)).toBeNull();
  });

  it('cue_list_shows_corner_rows', async () => {
    exerciseApi().install();
    renderApp({ path: `/exercises/${EXERCISE_ID}/cues` });
    const turns = await findEls('[data-turn]');
    expect(turns.map(turn => turn.getAttribute('data-turn'))).toEqual(['1', '2', '3']);
    expect(turns[0]).toHaveTextContent('Turn-in 461 m');
    expect(turns[0]).toHaveTextContent('Apex 519 m');
    expect(turns[0]).toHaveTextContent('Radius 43 m');
    expect(turns[0]).toHaveTextContent('89 km/h at the apex');
    const order = els('li.note').map(item => (item.dataset.cue ? `Cue ${item.dataset.cue}` : `Turn ${item.dataset.turn}`));
    expect(order).toEqual(['Cue 1', 'Turn 1', 'Cue 2', 'Cue 3', 'Turn 2', 'Turn 3']);
    expect(CUES.map(cue => cue.sM)).toEqual([332, 491, 600]);
  });

  it('maps_show_each_turn_as_a_band_with_its_label', async () => {
    exerciseApi()
      .on(`GET /api/references/${REFERENCE_ID}/corners`, [
        { ...CORNERS[0]!, zoneFromSM: 2, zoneToSM: 6 },
        { ...CORNERS[1]!, zoneFromSM: 8, zoneToSM: 12 },
        { ...CORNERS[2]!, zoneFromSM: 14, zoneToSM: 18 }
      ])
      .install();
    renderApp({ path: `/exercises/${EXERCISE_ID}/cues` });
    await findEl('[data-turn="1"]');
    expect(document.querySelectorAll('.track-map .track-turn')).toHaveLength(3);
    expect([...document.querySelectorAll('.track-map .track-turn-label')].map(label => label.textContent)).toEqual(['T1', 'T2', 'T3']);
    expect(screen.getByText('turn')).toBeInTheDocument();
    expect(screen.queryByText('apex of a turn')).toBeNull();
    expect(screen.queryByText('turn-in')).toBeNull();
  });
});

describe('cues map frame', () => {
  it('cues_map_panel_has_the_view_and_the_mute_note', async () => {
    exerciseApi().install();
    renderApp({ path: `/exercises/${EXERCISE_ID}/cues` });
    const user = userEvent.setup();
    const panel = await findSection('Reference line, 20 m');
    expect([...panel.querySelectorAll('.legend span')].map(span => span.textContent)).toEqual(['reference line', 'turn', 'voice cue', 'muted cue', 'cue not spoken', 'Select a number to mute that cue']);
    await user.click(await screen.findByRole('button', { name: 'View' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('checkbox', { name: 'Voice cues' })).toBeChecked();
    expect(within(dialog).getByRole('heading', { level: 2, name: 'Yangwang, EXP-1' })).toBeInTheDocument();
    expect(screen.queryByText('Map orientation is not confirmed')).toBeNull();
  });

  it('cues_map_number_still_mutes', async () => {
    const api = exerciseApi()
      .on(`PATCH /api/exercises/${EXERCISE_ID}`, exercise({ mutedCues: [CUES[0]!.key] }))
      .install();
    renderApp({ path: `/exercises/${EXERCISE_ID}/cues` });
    const panel = await findSection('Reference line, 20 m');
    const mark = mapMark('Mute cue 1', panel);
    await userEvent.setup().click(mark);
    await waitFor(() => expect(api.calls.find(call => call.method === 'PATCH')?.body).toEqual({ mutedCues: [CUES[0]!.key] }));
  });

  it('cue_list_stands_above_the_map_on_a_phone', async () => {
    setViewportWidth(390);
    exerciseApi().install();
    renderApp({ path: `/exercises/${EXERCISE_ID}/cues` });
    const panel = await findSection('Reference line, 20 m');
    const firstRow = els('[data-cue]')[0]!;
    expect(firstRow.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('cues not spoken', () => {
  const CUES_PATH = `/exercises/${EXERCISE_ID}/cues`;
  const PREVIEW = `GET /api/references/${REFERENCE_ID}/preview`;

  it('not_spoken_row_shows_the_tag_and_the_reason', async () => {
    exerciseApi()
      .on(PREVIEW, { ...NO_DROP_PREVIEW, dropped: [{ rowKey: 'throttle@491', reason: 'voice-busy', afterRowKey: 'brake@332' }] })
      .install();
    renderApp({ path: CUES_PATH });
    const row = await findEl('[data-cue="2"]');
    expect(await within(row).findByText('Not spoken')).toBeInTheDocument();
    expect(row).toHaveTextContent('The voice still says cue 1 here. Mute cue 1 or this cue, or move cue 1 earlier.');
    expect(screen.getByText(/1 cue is not spoken on the reference line\./)).toBeInTheDocument();
    expect(within(el('[data-cue="1"]')).queryByText('Not spoken')).toBeNull();
  });

  it('no_drop_no_tag', async () => {
    exerciseApi().install();
    renderApp({ path: CUES_PATH });
    await findEl('[data-cue="2"]');
    expect(screen.queryByText('Not spoken')).toBeNull();
    expect(screen.queryByText(/not spoken on the reference line/)).toBeNull();
  });

  it('a_muted_row_never_shows_not_spoken', async () => {
    exerciseApi(exercise({ mutedCues: ['throttle@491'] }))
      .on(PREVIEW, { ...NO_DROP_PREVIEW, dropped: [{ rowKey: 'throttle@491', reason: 'voice-busy', afterRowKey: 'brake@332' }] })
      .install();
    renderApp({ path: CUES_PATH });
    const row = await findEl('[data-cue="2"]');
    await findIconButton('Unmute cue 2', row);
    expect(within(row).queryByText('Not spoken')).toBeNull();
  });

  it('not_spoken_mark_on_the_map_has_a_badge', async () => {
    exerciseApi()
      .on(PREVIEW, { ...NO_DROP_PREVIEW, dropped: [{ rowKey: 'throttle@491', reason: 'too-late', afterRowKey: null }] })
      .install();
    renderApp({ path: CUES_PATH });
    const panel = await findSection('Reference line, 20 m');
    await waitFor(() => expect(panel.querySelectorAll('.not-spoken-badge')).toHaveLength(1));
  });

  it('preview_reloads_after_a_mute', async () => {
    const api = exerciseApi()
      .on(`PATCH /api/exercises/${EXERCISE_ID}`, exercise({ mutedCues: ['throttle@491'] }))
      .install();
    renderApp({ path: CUES_PATH });
    const row = await findEl('[data-cue="2"]');
    await waitFor(() => expect(api.calls.filter(call => `${call.method} ${call.path}` === PREVIEW)).toHaveLength(1));
    await userEvent.setup().click(iconButton('Mute cue 2', row));
    await waitFor(() => expect(api.calls.filter(call => `${call.method} ${call.path}` === PREVIEW)).toHaveLength(2));
  });

  it('a_failed_preview_shows_no_tag_and_no_error', async () => {
    exerciseApi()
      .on(PREVIEW, { status: 500, body: { code: 'internal' } })
      .install();
    renderApp({ path: CUES_PATH });
    await findEl('[data-cue="2"]');
    expect(screen.queryByText('Not spoken')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('cue preview', () => {
  const CUES_PATH = `/exercises/${EXERCISE_ID}/cues`;
  const PREVIEW_ROUTE = `GET /api/references/${REFERENCE_ID}/preview`;
  const PLAYING: CuePreview = {
    ...NO_DROP_PREVIEW,
    timeMs: 4000,
    gridTimeMs: [0, 2000, 4000],
    cues: [
      { key: 'brake@332', rowKey: 'brake@332', clip: 'hard-brake', followClip: 'speed-85', atMs: 1000 },
      { key: 'throttle@491', rowKey: 'throttle@491', clip: 'full-throttle', followClip: null, atMs: 3000 }
    ]
  };

  async function openPreview(options: { width?: number; api?: ReturnType<typeof exerciseApi> } = {}) {
    if (options.width) setViewportWidth(options.width);
    const api = (options.api ?? exerciseApi().on(PREVIEW_ROUTE, PLAYING)).install();
    const rig = playerRig();
    const played: string[][] = [];
    vi.spyOn(rig.player, 'playLoaded').mockImplementation((...clips: string[]) => {
      played.push(clips);
      return true;
    });
    const preload = vi.spyOn(rig.player, 'preload').mockResolvedValue();
    const unlock = vi.spyOn(rig.player, 'unlock').mockResolvedValue();
    const stop = vi.spyOn(rig.player, 'stop');
    const view = renderApp({ path: CUES_PATH, player: rig.player });
    const button = await findIconButton('Preview the cues');
    await waitFor(() => expect(button).toBeEnabled());
    return { api, played, stop, preload, unlock, view, button };
  }

  async function advance(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  function fake() {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'performance'] });
  }

  it('preview_plays_each_cue_at_its_time', async () => {
    const { played, button } = await openPreview();
    fake();
    await act(async () => {
      fireEvent.click(button);
    });
    await advance(950);
    expect(played).toEqual([]);
    await advance(100);
    expect(played).toEqual([['hard-brake', 'speed-85']]);
    expect(iconButton('Stop the preview')).toBeInTheDocument();
    await advance(2000);
    expect(played).toEqual([['hard-brake', 'speed-85'], ['full-throttle']]);
    await advance(1100);
    expect(iconButton('Preview the cues')).toBeInTheDocument();
  });

  it('preview_shows_the_speaking_row_and_the_time', async () => {
    const { button } = await openPreview();
    fake();
    await act(async () => {
      fireEvent.click(button);
    });
    await advance(1100);
    expect(within(el('[data-cue="1"]')).getByText('Speaking')).toBeInTheDocument();
    expect(screen.getByText('The voice says:').closest('p')).toHaveTextContent('The voice says: Hard brake. Eighty five (cue 1)');
    expect(screen.getByText('0:01.1 of 0:04.0, measured')).toBeInTheDocument();
    expect(document.querySelector('.track-cursor')).not.toBeNull();
    expect(document.querySelectorAll('.track-mark.speaking')).toHaveLength(1);
  });

  it('stop_ends_the_preview_and_the_sound', async () => {
    const { played, stop, button } = await openPreview();
    fake();
    await act(async () => {
      fireEvent.click(button);
    });
    await advance(500);
    await act(async () => {
      fireEvent.click(iconButton('Stop the preview'));
    });
    expect(stop).toHaveBeenCalled();
    await advance(5000);
    expect(played).toEqual([]);
    expect(document.querySelector('.track-cursor')).toBeNull();
    expect(screen.getByText('Preview plays the cues on this device in the time of the reference.')).toBeInTheDocument();
  });

  it('a_settings_change_stops_the_preview', async () => {
    const { button } = await openPreview({
      api: exerciseApi()
        .on(PREVIEW_ROUTE, PLAYING)
        .on(`PATCH /api/exercises/${EXERCISE_ID}`, exercise({ mutedCues: ['throttle@491'] }))
    });
    fireEvent.click(button);
    await findIconButton('Stop the preview');
    fireEvent.click(iconButton('Mute cue 2', el('[data-cue="2"]')));
    expect(await findIconButton('Preview the cues')).toBeInTheDocument();
  });

  it('preview_sends_a_pending_timing_first', async () => {
    let current = exercise();
    const api = exerciseApi()
      .on(PREVIEW_ROUTE, PLAYING)
      .on(`GET /api/exercises/${EXERCISE_ID}`, () => current)
      .on(`PATCH /api/exercises/${EXERCISE_ID}`, (body: unknown) => {
        current = { ...current, ...(body as Partial<Exercise>) };
        return current;
      });
    const { button } = await openPreview({ api });
    const slider = sliderOf(el('[data-cue="1"]'));
    fireEvent.change(slider, { target: { value: '-300' } });
    fireEvent.click(button);
    await findIconButton('Stop the preview');
    const routes = api.calls.map(call => `${call.method} ${call.path}`);
    const patch = routes.indexOf(`PATCH /api/exercises/${EXERCISE_ID}`);
    expect(patch).toBeGreaterThan(-1);
    expect(routes.slice(patch).filter(route => route === PREVIEW_ROUTE)).toHaveLength(1);
    expect(api.calls[patch]!.body).toEqual({ cueOffsetsMs: { 'brake@332': 300 } });
  });

  it('leaving_the_tab_stops_the_preview', async () => {
    const { stop, view, button } = await openPreview();
    fake();
    await act(async () => {
      fireEvent.click(button);
    });
    await advance(200);
    view.unmount();
    expect(stop).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('preview_unlocks_the_sound_inside_the_click_and_loads_every_clip_first', async () => {
    const { preload, unlock, button } = await openPreview();
    fireEvent.click(button);
    expect(unlock).toHaveBeenCalledTimes(1);
    await findIconButton('Stop the preview');
    expect(preload).toHaveBeenCalledWith(['hard-brake', 'speed-85', 'full-throttle']);
  });

  it('a_preview_that_resolves_after_leaving_the_tab_does_not_start', async () => {
    let current = exercise();
    const api = exerciseApi()
      .on(PREVIEW_ROUTE, PLAYING)
      .on(`GET /api/exercises/${EXERCISE_ID}`, () => current)
      .on(`PATCH /api/exercises/${EXERCISE_ID}`, (body: unknown) => {
        current = { ...current, ...(body as Partial<Exercise>) };
        return current;
      });
    const { played, view, button } = await openPreview({ api });
    fireEvent.change(sliderOf(el('[data-cue="1"]')), { target: { value: '-300' } });
    fake();
    fireEvent.click(button);
    view.unmount();
    await advance(5000);
    expect(played).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('phone_shows_the_cue_list_before_the_map_and_the_settings_after_it', async () => {
    await openPreview({ width: 390 });
    const layout = el('.cues-layout');
    const order = [el('.roadbook', layout), el('.map-panel', layout), el('.voice-settings', layout)];
    for (let index = 1; index < order.length; index += 1) {
      expect(order[index - 1]!.compareDocumentPosition(order[index]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it('desktop_keeps_the_settings_above_the_list_and_the_map_in_its_own_column', async () => {
    await openPreview();
    const layout = el('.cues-layout');
    const settings = el('.voice-settings', layout);
    expect(settings.compareDocumentPosition(el('.roadbook', layout)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(el('.map-panel', layout).parentElement).toHaveClass('cues-map');
  });

  it('phone_view_button_has_no_text', async () => {
    await openPreview({ width: 390 });
    const view = screen.getByRole('button', { name: 'View the map in full screen' });
    expect(view).toHaveAttribute('title', 'View the map in full screen');
    expect(view).not.toHaveTextContent('View');
  });

  it('desktop_view_button_keeps_its_text', async () => {
    await openPreview();
    expect(screen.getByRole('button', { name: 'View' })).toHaveTextContent('View');
  });
});
