import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { RaceDetail } from '@gt7/contracts';
import { PANORAMA_LAPS, RACE_ID, lapsSpeed, raceDetail, raceDistances } from './race-fixtures.ts';
import { ApiStub, dialogOf, el, els, findEl, maybeEl, renderApp, sectionOf, setViewportWidth, signedIn } from './support.tsx';

function raceApi(detail: RaceDetail = raceDetail(), distances: unknown = raceDistances(detail)): ApiStub {
  return signedIn(new ApiStub()).on(`GET /api/races/${detail.id}`, detail).on(`GET /api/races/${detail.id}/speed`, lapsSpeed()).on(`GET /api/races/${detail.id}/distances`, distances).install();
}

async function openRace(detail: RaceDetail = raceDetail()) {
  const api = raceApi(detail);
  renderApp({ path: `/races/${detail.id}` });
  await screen.findByRole('heading', { level: 1 });
  return api;
}

function bandValues(): string[] {
  return [...document.querySelectorAll('.race-band-value')].map(value => value.textContent ?? '');
}

function lapRows(): HTMLElement[] {
  return els('.race-laps-table tbody tr');
}

describe('race page, laps tab', () => {
  it('shows_the_head_with_breadcrumb_name_and_tabs', async () => {
    await openRace();
    expect(screen.getByRole('heading', { level: 1, name: 'Mount Panorama' })).toBeInTheDocument();
    const crumbs = el('nav.breadcrumb');
    expect(within(crumbs).getByRole('link', { name: 'Races' })).toHaveAttribute('href', '/races');
    expect(crumbs).toHaveTextContent(/^Races \/ Mount Panorama$/);
    expect(screen.getByText(/^20 Nov 2026, 17:36 · lap length 6,165 m$/)).toBeInTheDocument();
    expect(screen.queryByText(/Track name from the lap length/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change the name' })).toBeInTheDocument();
    const tabs = el('nav.exercise-tabs');
    expect(within(tabs).getAllByRole('link').map(link => [link.textContent, link.getAttribute('href')])).toEqual([
      ['Laps', `/races/${RACE_ID}`],
      ['Compare', `/races/${RACE_ID}/compare`],
      ['Off the track', `/races/${RACE_ID}/off-track`],
      ['Golden lap', `/races/${RACE_ID}/golden`]
    ]);
    expect(within(tabs).getByRole('link', { name: 'Laps' })).toHaveAttribute('aria-current', 'page');
    expect(within(el('nav.nav')).getByRole('link', { name: 'Races' })).toHaveAttribute('aria-current', 'page');
  });

  it('shows_the_band_with_the_car_the_facts_and_three_values', async () => {
    await openRace();
    const band = sectionOf("BAC Mono '16");
    expect(band).toHaveTextContent('7 laps · 20 cars · 2 pit stops');
    expect(bandValues()).toEqual(['17:09.768race time', '2:18.285best lap · lap 4', '20 → 2position, start to finish']);
  });

  it('lists_the_laps_with_gap_position_speed_notes_and_links', async () => {
    await openRace();
    const rows = lapRows();
    expect(rows).toHaveLength(9);
    const first = rows[0]!;
    expect(within(first).getByRole('link')).toHaveAttribute('href', `/races/${RACE_ID}/compare?lap=1`);
    expect(first).toHaveTextContent('2:22.032');
    expect(first).toHaveTextContent('+3.747 s');
    expect(first).toHaveTextContent('20 → 9');
    expect(first).toHaveTextContent('276 km/h');
    expect(rows[1]).toHaveTextContent('into the pit lane');
    expect(rows[3]).toHaveTextContent('out of the pit lane');
    const best = rows[4]!;
    expect(best).toHaveClass('best');
    expect(within(best).getByText('best')).toHaveClass('tag');
    expect(best.querySelector('.race-gap')?.textContent).toBe('');
    expect(rows.at(-1)).toHaveTextContent('+2.020 s');
  });

  it('puts_the_off_track_counts_in_two_fixed_places_and_says_none', async () => {
    await openRace(raceDetail({ laps: PANORAMA_LAPS.map(lap => (lap.number === 4 ? { ...lap, offAll: 0, offPart: 0 } : lap)) }));
    const rows = lapRows();
    const cells = rows.filter(row => row.classList.contains('race-lap')).map(row => row.querySelector('.race-off')!);
    expect(cells.map(cell => [...cell.children].map(child => child.textContent))).toEqual([
      ['', '1'],
      ['', '3'],
      ['1', '2'],
      ['none'],
      ['', '2'],
      ['3', '1'],
      ['1', '5']
    ]);
  });

  it('puts_a_pit_stop_row_between_the_in_lap_and_the_out_lap', async () => {
    await openRace();
    const rows = lapRows();
    const pit = rows[2]!;
    expect(pit).toHaveClass('race-pit');
    expect(within(pit).queryByRole('link')).toBeNull();
    expect(pit).toHaveTextContent('PIT STOP');
    expect(pit).toHaveTextContent('35.48 s in the pit lane');
    expect(pit).toHaveTextContent('Fuel 38 → 100');
    expect(pit.querySelector('.race-pit-line')?.textContent).toBe('PIT STOP35.48 s in the pit laneFuel 38 → 100');
    expect(rows[6]).toHaveTextContent('38.19 s in the pit lane');
    expect(rows.map(row => row.querySelector('.race-lap-number')?.textContent ?? 'pit')).toEqual(['1', '2', 'pit', '3', '4', '5', 'pit', '6', '7']);
  });

  it('says_how_to_compare_and_explains_the_marks', async () => {
    await openRace();
    expect(screen.getByText('all 4 wheels off the track')).toBeInTheDocument();
    expect(screen.getByText('2 or 3 wheels off')).toBeInTheDocument();
  });

  it('shows_position_and_fuel_charts_with_their_headings', async () => {
    await openRace();
    expect(screen.getByRole('heading', { level: 2, name: 'Laps' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Position' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Fuel' })).toBeInTheDocument();
    expect(el('[data-chart="race-position"] .race-chart-plot').closest('.race-chart')!).toBeInTheDocument();
    expect(el('[data-chart="race-fuel"] .race-chart-plot').closest('.race-chart')!).toBeInTheDocument();
    expect(screen.queryByText('pit stop')).not.toBeInTheDocument();
    expect(screen.queryByText('Numbers under the chart: laps')).not.toBeInTheDocument();
    for (const id of ['race-position', 'race-fuel']) {
      const figure = el(`[data-chart="${id}"]`);
      expect(figure).toHaveClass('chart-field');
      expect([...figure.querySelectorAll('.axis-pit')].map(label => label.textContent)).toEqual(['P1', 'P2']);
      expect(figure.querySelector('.axis-name')!.textContent).toBe('lap');
    }
    const position = el('[data-chart="race-position"] .race-chart-plot').closest('.race-chart')!;
    expect([...position.querySelectorAll('.y-axis .axis-bold')].map(label => label.textContent)).toEqual(['20', '2']);
    expect([...position.querySelectorAll('.y-axis span')].map(label => label.textContent)).not.toContain('1');
    const plot = el('[data-chart="race-fuel"] .race-chart-plot').closest('.race-chart')!.querySelector('svg')!;
    const bands = [...plot.querySelectorAll('.race-chart-pit')].map(band => [Number(band.getAttribute('x')), Number(band.getAttribute('width'))]);
    expect(bands).toEqual([
      [Number(((285_000 / 1_029_768) * 800).toFixed(1)), Number(((320_480 / 1_029_768) * 800).toFixed(1)) - Number(((285_000 / 1_029_768) * 800).toFixed(1))],
      [Number(((730_000 / 1_029_768) * 800).toFixed(1)), Number(((768_190 / 1_029_768) * 800).toFixed(1)) - Number(((730_000 / 1_029_768) * 800).toFixed(1))]
    ]);
  });

  it('has_no_fuel_chart_when_the_fuel_does_not_change', async () => {
    await openRace(
      raceDetail({
        pitStops: 0,
        pitStopList: [],
        fuel: [
          { tMs: 0, fuel: 100 },
          { tMs: 1_029_768, fuel: 100 }
        ],
        laps: PANORAMA_LAPS.map(lap => ({ ...lap, pitIn: false, pitOut: false }))
      })
    );
    expect(screen.queryByRole('heading', { level: 2, name: 'Fuel' })).not.toBeInTheDocument();
    expect(screen.queryByText('pit stop')).not.toBeInTheDocument();
    expect(sectionOf("BAC Mono '16")).toHaveTextContent('7 laps · 20 cars');
    expect(sectionOf("BAC Mono '16")).not.toHaveTextContent('pit stop');
  });

  it('shows_a_race_that_is_not_finished_with_its_laps_and_captions', async () => {
    const laps = PANORAMA_LAPS.slice(4).map(lap => ({ ...lap, pitIn: false, pitOut: lap.number === 5 }));
    await openRace(raceDetail({ complete: false, firstLap: 5, lapsDone: 3, startPosition: 3, pitStops: 0, pitStopList: [], laps, bestLap: 7, bestLapMs: 140_305, raceMs: 451_670 }));
    const band = sectionOf("BAC Mono '16");
    expect(band).toHaveTextContent('laps 5 to 7 of 7, not finished · 20 cars');
    expect(bandValues()).toEqual(['7:31.670time of the recorded laps', '2:20.305best lap · lap 7', '3 → 2position, laps 5 to 7']);
    const rows = lapRows();
    expect(rows.map(row => row.querySelector('.race-lap-number')?.textContent)).toEqual(['5', '6', '7']);
    expect(rows[0]).toHaveTextContent('out of the pit lane');
    expect(within(el('[data-chart="race-position"] .race-chart-plot').closest('.race-chart')!.parentElement!).getAllByText(/^[0-9]$/).map(label => label.textContent)).toContain('5');
  });

  it('says_3_of_7_laps_for_a_race_stopped_after_lap_3', async () => {
    await openRace(raceDetail({ complete: false, lapsDone: 3, laps: PANORAMA_LAPS.slice(0, 3), pitStops: 1, pitStopList: [raceDetail().pitStopList[0]!], bestLap: 3, bestLapMs: 139_931, raceMs: 439_813, finishPosition: 6 }));
    expect(sectionOf("BAC Mono '16")).toHaveTextContent('3 of 7 laps, not finished · 20 cars · 1 pit stop');
    expect(bandValues()).toContain('20 → 6position, start to lap 3');
  });

  it('names_a_race_without_a_track_name', async () => {
    await openRace(raceDetail({ trackName: null, trackCandidates: ['Tsukuba Circuit', 'Tsukuba Circuit Reverse'] }));
    expect(screen.getByRole('heading', { level: 1, name: 'Race without a track name' })).toBeInTheDocument();
    expect(screen.queryByText(/does not send/)).not.toBeInTheDocument();
    expect(screen.getByText(/^20 Nov 2026, 17:36 · lap length 6,165 m$/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Name the track' })).toBeInTheDocument();
  });

  it('gives_only_the_date_when_the_lap_length_is_not_known', async () => {
    await openRace(raceDetail({ lapLengthM: null }));
    expect(screen.getByText(/^20 Nov 2026, 17:36$/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change the name' })).toBeInTheDocument();
  });

  it('shows_only_change_the_name_for_a_name_of_the_player', async () => {
    await openRace(raceDetail({ trackName: 'My home track', trackCandidates: ['Mount Panorama'] }));
    expect(screen.queryByText(/Track name from the lap length/)).not.toBeInTheDocument();
    expect(screen.queryByText(/does not send/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change the name' })).toBeInTheDocument();
  });

  it('name_dialog_opens_cancels_and_saves_a_candidate', async () => {
    const detail = raceDetail({ trackName: null, trackCandidates: ['High Speed Ring', 'High Speed Ring Reverse'] });
    const api = await openRace(detail);
    api.on(`PATCH /api/races/${RACE_ID}`, (body: unknown) => ({ ...detail, laps: undefined, trackName: (body as { trackName: string }).trackName }));
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Name the track' }));
    let dialog = dialogOf('Name the track');
    const choices = el('.track-choices', dialog);
    expect(within(choices).getAllByRole('radio').map(radio => radio.textContent)).toEqual(['High Speed Ring', 'High Speed Ring Reverse', 'Another name']);
    expect(within(choices).getByRole('radio', { name: 'High Speed Ring' })).toHaveAttribute('aria-checked', 'true');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(api.called(`PATCH /api/races/${RACE_ID}`)).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Name the track' }));
    dialog = dialogOf('Name the track');
    await user.click(within(dialog).getByRole('radio', { name: 'High Speed Ring Reverse' }));
    await user.click(within(dialog).getByRole('button', { name: 'Save the name' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(api.calls.find(call => call.method === 'PATCH')!.body).toEqual({ trackName: 'High Speed Ring Reverse' });
    expect(screen.getByRole('heading', { level: 1, name: 'High Speed Ring Reverse' })).toBeInTheDocument();
    expect(lapRows()).toHaveLength(9);
  });

  it('name_dialog_saves_another_name_and_needs_text', async () => {
    const api = await openRace(raceDetail({ trackName: 'Mount Panorama' }));
    api.on(`PATCH /api/races/${RACE_ID}`, { ...raceDetail(), trackName: 'Bathurst' });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Change the name' }));
    const dialog = dialogOf('Name the track');
    await user.click(within(dialog).getByRole('radio', { name: 'Another name' }));
    const field = within(dialog).getByRole('textbox', { name: 'Another name' });
    expect(within(dialog).getByRole('button', { name: 'Save the name' })).toBeDisabled();
    await user.type(field, '  Bathurst ');
    await user.click(within(dialog).getByRole('button', { name: 'Save the name' }));
    await waitFor(() => expect(api.called(`PATCH /api/races/${RACE_ID}`)).toBe(true));
    expect(api.calls.find(call => call.method === 'PATCH')!.body).toEqual({ trackName: 'Bathurst' });
  });

  it('name_dialog_shows_a_save_error', async () => {
    const api = await openRace();
    api.on(`PATCH /api/races/${RACE_ID}`, { status: 500, body: { code: 'server-error' } });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Change the name' }));
    const dialog = dialogOf('Name the track');
    await user.click(within(dialog).getByRole('button', { name: 'Save the name' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Something went wrong in GT7 Tutor (status 500).');
  });

  it('phone_lap_row_has_two_lines_and_the_pit_row_is_short', async () => {
    setViewportWidth(390);
    await openRace();
    const rows = lapRows();
    expect(rows[0]!.querySelector('.race-lap-line')?.textContent).toBe('2:22.032+3.747 s');
    expect(rows[0]!.querySelector('.race-lap-facts')?.textContent).toBe('20 → 9 · 276 km/h');
    expect(rows[1]!.querySelector('.race-lap-facts')?.textContent).toBe('9 → 11 · 281 km/h · into the pit lane');
    expect(rows[2]!.querySelector('.race-pit-line')?.textContent).toBe('PIT STOP35.48 sFuel 38 → 100');
  });

  it('shows_not_found_for_an_unknown_race', async () => {
    signedIn(new ApiStub()).on(`GET /api/races/${RACE_ID}`, { status: 404, body: { code: 'race-not-found' } }).install();
    renderApp({ path: `/races/${RACE_ID}` });
    expect(await screen.findByRole('heading', { level: 1, name: 'This race is not here' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Races' })).toHaveAttribute('href', '/races');
  });
});

describe('race page, speed of all laps', () => {

  async function openSpeed(speed: unknown = lapsSpeed(), detail: RaceDetail = raceDetail()) {
    signedIn(new ApiStub()).on(`GET /api/races/${RACE_ID}`, detail).on(`GET /api/races/${RACE_ID}/speed`, speed).install();
    renderApp({ path: `/races/${RACE_ID}` });
    return findEl('[data-chart="race-speed"]');
  }

  function box(): string[] {
    return [...document.querySelectorAll('.chart-box li')].map(item => item.textContent ?? '');
  }

  it('draws_one_line_per_lap_in_its_own_colour_with_a_thicker_best_lap', async () => {
    const chart = await openSpeed();
    expect(screen.getByRole('heading', { level: 2, name: 'Speed' })).toBeInTheDocument();
    const lines = [...chart.querySelectorAll('[data-series="lap"]')];
    expect(lines.map(line => line.getAttribute('data-colour'))).toEqual(['0', '1', '2', '4', '5', '6', '3']);
    expect(lines.map(line => line.classList.contains('strong'))).toEqual([false, false, false, false, false, false, true]);
    expect(chart.querySelectorAll('[data-series="ref"]')).toHaveLength(0);
    expect([...chart.querySelectorAll('.chart-band')].map(band => band.getAttribute('data-band'))).toEqual(['T1', 'T2']);
    expect(screen.queryByText(/best lap, lap|other laps/)).not.toBeInTheDocument();
    expect(screen.getByText('turn').closest('button')).toBeNull();
    const field = chart.closest('.chart-field')!;
    expect(field.querySelector('.field-title')).toBeNull();
    expect(field.querySelector('.field-unit')!.textContent).toBe('km/h');
    expect(field.querySelector('.distance-axis .axis-start')!.textContent).toBe('0 m');
  });

  it('gives_the_values_in_the_box_in_lap_order_without_a_readout_or_a_cursor_line', async () => {
    const chart = await openSpeed();
    expect(chart.closest('.channel')!.querySelector('.channel-readout')).toBeNull();
    expect(screen.queryByText(/^at 0 m:/)).not.toBeInTheDocument();
    expect(document.querySelector('.chart-box')).toBeNull();
    fireEvent.pointerEnter(chart);
    expect(document.querySelector('.chart-box-title')?.textContent).toBe('0 m');
    expect(box()).toEqual(['Lap 1: 140 km/h', 'Lap 2: 142 km/h', 'Lap 3: no data', 'Lap 4: 148 km/h', 'Lap 5: 148 km/h', 'Lap 6: 150 km/h', 'Lap 7: 152 km/h']);
    expect(chart.querySelectorAll('.chart-dot')).toHaveLength(6);
    expect(screen.queryByText(/^Cursor at [\d,]+ m of/)).not.toBeInTheDocument();
  });

  it('moves_the_cursor_with_the_keyboard_and_names_the_turn', async () => {
    const chart = await openSpeed();
    chart.focus();
    const user = userEvent.setup();
    await user.keyboard('{End}');
    expect(chart).toHaveAttribute('aria-valuenow', '6165');
    expect(box()).toContain('Lap 2: no data');
    await user.keyboard('{Home}');
    for (let step = 0; step < 52; step++) await user.keyboard('{PageUp}');
    expect(chart).toHaveAttribute('aria-valuenow', '5200');
    await user.keyboard('{Home}{PageUp}{PageUp}{PageUp}{PageUp}{PageUp}{PageUp}');
    expect(chart).toHaveAttribute('aria-valuenow', '600');
    expect(document.querySelector('.chart-box-title')?.textContent).toBe('600 m · T1');
  });

  it('keeps_the_box_inside_the_plot_at_both_ends', async () => {
    const chart = await openSpeed();
    act(() => chart.focus());
    expect(document.querySelector('.chart-box')).toHaveClass('right');
    await userEvent.setup().keyboard('{End}');
    expect(document.querySelector('.chart-box')).toHaveClass('left');
  });

  it('shows_the_box_only_while_the_pointer_is_over_the_chart_or_the_chart_has_focus', async () => {
    const chart = await openSpeed();
    expect(document.querySelector('.chart-box')).toBeNull();
    fireEvent.pointerEnter(chart);
    expect(document.querySelector('.chart-box')).not.toBeNull();
    fireEvent.pointerLeave(chart);
    expect(document.querySelector('.chart-box')).toBeNull();
    fireEvent.focus(chart);
    expect(document.querySelector('.chart-box')).not.toBeNull();
    fireEvent.blur(chart);
    expect(document.querySelector('.chart-box')).toBeNull();
    fireEvent.pointerEnter(chart);
    act(() => chart.focus());
    fireEvent.pointerLeave(chart);
    expect(document.querySelector('.chart-box')).toBeNull();
    fireEvent.keyDown(chart, { key: 'ArrowRight' });
    expect(document.querySelector('.chart-box')).not.toBeNull();
  });

  it('shows_the_box_on_a_phone_too', async () => {
    setViewportWidth(390);
    const chart = await openSpeed();
    fireEvent.pointerEnter(chart);
    expect(box()).toHaveLength(7);
    expect(chart.closest('.channel')!.querySelector('.channel-readout')).toBeNull();
  });

  it('names_the_laps_of_the_game_for_a_race_from_lap_5', async () => {
    const laps = PANORAMA_LAPS.slice(4).map(lap => ({ ...lap, pitIn: false, pitOut: false }));
    const chart = await openSpeed(lapsSpeed(5, 3, 7), raceDetail({ complete: false, firstLap: 5, lapsDone: 3, pitStops: 0, pitStopList: [], laps, bestLap: 7, bestLapMs: 140_305, referenceLap: 7, raceMs: 451_670 }));
    fireEvent.pointerEnter(chart);
    expect(within(el('.lap-legend')).getAllByRole('button').map(button => button.textContent)).toEqual(['Lap 5', 'Lap 6', 'Lap 7']);
    expect(box()).toEqual(['Lap 5: 140 km/h', 'Lap 6: 142 km/h', 'Lap 7: 148 km/h']);
  });

  function legendButtons(): HTMLElement[] {
    return within(el('.lap-legend')).getAllByRole('button');
  }

  it('has_a_legend_button_per_lap_with_its_colour_and_no_word_best', async () => {
    await openSpeed();
    const buttons = legendButtons();
    expect(buttons.map(button => button.textContent)).toEqual(['Lap 1', 'Lap 2', 'Lap 3', 'Lap 4', 'Lap 5', 'Lap 6', 'Lap 7']);
    buttons.forEach(button => expect(button).toHaveAttribute('aria-pressed', 'true'));
    expect(buttons.map(button => button.querySelector('.chart-swatch')!.getAttribute('data-colour'))).toEqual(['0', '1', '2', '3', '4', '5', '6']);
    expect(buttons.map(button => button.querySelector('.chart-swatch')!.classList.contains('strong'))).toEqual([false, false, false, true, false, false, false]);
  });

  it('hides_and_shows_a_lap_with_its_legend_button', async () => {
    const chart = await openSpeed();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Lap 2' }));
    expect(screen.getByRole('button', { name: 'Lap 2' })).toHaveAttribute('aria-pressed', 'false');
    expect([...chart.querySelectorAll('[data-series="lap"]')].map(line => line.getAttribute('data-colour'))).toEqual(['0', '2', '4', '5', '6', '3']);
    fireEvent.pointerEnter(chart);
    expect(box()).toEqual(['Lap 1: 140 km/h', 'Lap 3: no data', 'Lap 4: 148 km/h', 'Lap 5: 148 km/h', 'Lap 6: 150 km/h', 'Lap 7: 152 km/h']);
    expect(chart.querySelectorAll('.chart-dot')).toHaveLength(5);
    expect(document.querySelectorAll('.chart-box .chart-swatch')[0]!.getAttribute('data-colour')).toBe('0');
    await user.click(screen.getByRole('button', { name: 'Lap 2' }));
    expect(screen.getByRole('button', { name: 'Lap 2' })).toHaveAttribute('aria-pressed', 'true');
    expect(chart.querySelectorAll('[data-series="lap"]')).toHaveLength(7);
  });

  it('can_hide_all_laps_and_keeps_the_speed_axis', async () => {
    const chart = await openSpeed();
    const ticks = () => [...chart.closest('.chart-field')!.querySelectorAll('.y-axis span')].map(span => span.textContent);
    const before = ticks();
    const user = userEvent.setup();
    for (const button of legendButtons()) await user.click(button);
    legendButtons().forEach(button => expect(button).toHaveAttribute('aria-pressed', 'false'));
    expect(chart.querySelectorAll('[data-series="lap"]')).toHaveLength(0);
    expect(chart.querySelectorAll('.chart-dot')).toHaveLength(0);
    expect(ticks()).toEqual(before);
    fireEvent.pointerEnter(chart);
    expect(document.querySelector('.chart-box')).toBeNull();
  });

  it('shows_all_laps_again_when_the_tab_opens_again', async () => {
    await openSpeed();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Lap 1' }));
    expect(screen.getByRole('button', { name: 'Lap 1' })).toHaveAttribute('aria-pressed', 'false');
    cleanup();
    await openSpeed();
    expect(screen.getByRole('button', { name: 'Lap 1' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('repeats_the_colours_after_10_laps', async () => {
    const laps = Array.from({ length: 12 }, (_, index) => ({ ...PANORAMA_LAPS[0]!, number: index + 1, pitIn: false, pitOut: false }));
    const chart = await openSpeed(lapsSpeed(1, 12, 4), raceDetail({ laps, lapsDone: 12, lapsInRace: 12, pitStops: 0, pitStopList: [], bestLap: 4 }));
    expect([...chart.querySelectorAll('[data-series="lap"]')].map(line => line.getAttribute('data-colour'))).toEqual(['0', '1', '2', '4', '5', '6', '7', '8', '9', '0', '1', '3']);
  });

  const VIEW = 'View';

  async function openFull() {
    const chart = await openSpeed();
    const view = screen.getByRole('button', { name: VIEW });
    await userEvent.setup().click(view);
    return { chart, view, dialog: dialogOf('Speed') };
  }

  it('has_a_view_button_in_the_chart_field_beside_the_unit', async () => {
    const chart = await openSpeed();
    const view = screen.getByRole('button', { name: VIEW });
    expect(view).toHaveTextContent('View');
    expect(view.closest('.chart-field')).toBe(chart.closest('.chart-field'));
    expect(view.closest('.field-head')!.querySelector('.field-unit')!.textContent).toBe('km/h');
  });

  it('opens_the_speed_chart_in_full_screen_with_the_race_and_the_laps', async () => {
    const { dialog } = await openFull();
    expect(within(dialog).getByRole('heading', { level: 2, name: 'Speed' })).toBeInTheDocument();
    expect(within(dialog).getByText('Mount Panorama, 7 laps. Press Esc to close.')).toBeInTheDocument();
    const chart = el('[data-chart="race-speed-full"]', dialog);
    expect(chart.querySelectorAll('[data-series="lap"]')).toHaveLength(7);
    expect(within(el('.lap-legend', dialog)).getAllByRole('button')).toHaveLength(7);
    fireEvent.pointerEnter(chart);
    expect(chart.querySelectorAll('.chart-dot')).toHaveLength(6);
    expect([...chart.querySelectorAll('.chart-box li')].map(row => row.textContent)).toHaveLength(7);
  });

  it('gives_no_esc_hint_on_a_phone', async () => {
    setViewportWidth(390);
    const { dialog } = await openFull();
    expect(within(dialog).getByText('Mount Panorama, 7 laps.')).toBeInTheDocument();
    expect(within(dialog).queryByText(/Press Esc/)).not.toBeInTheDocument();
    const chart = el('[data-chart="race-speed-full"]', dialog);
    fireEvent.pointerEnter(chart);
    expect(chart.querySelector('.chart-box')).not.toBeNull();
  });

  it('closes_with_esc_and_with_back_and_gives_the_focus_back_to_view', async () => {
    const { view } = await openFull();
    const user = userEvent.setup();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(view).toHaveFocus();
    await user.click(view);
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Back' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(view).toHaveFocus();
  });

  it('shares_the_hidden_laps_with_the_full_screen_chart', async () => {
    const user = userEvent.setup();
    const chart = await openSpeed();
    await user.click(screen.getByRole('button', { name: 'Lap 1' }));
    await user.click(screen.getByRole('button', { name: VIEW }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'Lap 1' })).toHaveAttribute('aria-pressed', 'false');
    expect(el('[data-chart="race-speed-full"]', dialog).querySelectorAll('[data-series="lap"]')).toHaveLength(6);
    await user.click(within(dialog).getByRole('button', { name: 'Lap 3' }));
    await user.click(within(dialog).getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('button', { name: 'Lap 3' })).toHaveAttribute('aria-pressed', 'false');
    expect(chart.querySelectorAll('[data-series="lap"]')).toHaveLength(5);
  });

  it('locks_the_page_scroll_while_the_full_screen_chart_is_open', async () => {
    await openFull();
    expect(document.body.style.overflow).toBe('hidden');
    await userEvent.setup().keyboard('{Escape}');
    expect(document.body.style.overflow).toBe('');
  });

  it('lets_the_box_of_the_full_screen_chart_go_past_the_plot', async () => {
    const { dialog } = await openFull();
    const chart = el('[data-chart="race-speed-full"]', dialog);
    fireEvent.pointerEnter(chart);
    const classes = new Set<string>();
    for (let node = chart.querySelector('.chart-box')!.parentElement; node && node !== dialog; node = node.parentElement) node.classList.forEach(name => classes.add(name));
    const css = ['styles/base.css', 'charts/charts.css', 'charts/map-dialog.css', 'features/races/races.css', 'features/review/review.css'].map(file => readFileSync(join(import.meta.dirname, '../src', file), 'utf8')).join('\n');
    const clipping = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter(([, , body]) => /(^|[;\s])overflow(-x|-y)?\s*:\s*(hidden|auto|scroll|clip)/.test(body!))
      .flatMap(([, selector]) => selector!.split(',').map(part => part.trim()))
      .filter(selector => [...classes].some(name => new RegExp(`\\.${name}(?![\\w-])[^\\s>+~]*$`).test(selector)));
    expect(clipping).toEqual([]);
  });

  it('says_the_recording_is_gone_and_keeps_the_table', async () => {
    signedIn(new ApiStub())
      .on(`GET /api/races/${RACE_ID}`, raceDetail())
      .on(`GET /api/races/${RACE_ID}/speed`, { status: 409, body: { code: 'raw-missing' } })
      .install();
    renderApp({ path: `/races/${RACE_ID}` });
    expect(await screen.findByText('The recording of this race is no longer on the disk. The lap table stays.')).toBeInTheDocument();
    expect(el('.race-laps-table table')).toBeInTheDocument();
    expect(maybeEl('[data-chart="race-speed"]')).not.toBeInTheDocument();
  });

  it('shows_another_error_as_it_comes', async () => {
    signedIn(new ApiStub())
      .on(`GET /api/races/${RACE_ID}`, raceDetail())
      .on(`GET /api/races/${RACE_ID}/speed`, { status: 500, body: { code: 'server-error' } })
      .install();
    renderApp({ path: `/races/${RACE_ID}` });
    expect(await screen.findByText(/Something went wrong in GT7 Tutor \(status 500\)\./)).toBeInTheDocument();
  });

  it('shows_the_table_while_the_speed_loads', async () => {
    signedIn(new ApiStub())
      .on(`GET /api/races/${RACE_ID}`, raceDetail())
      .on(`GET /api/races/${RACE_ID}/speed`, () => new Promise(() => undefined))
      .install();
    renderApp({ path: `/races/${RACE_ID}` });
    expect(await findEl('.race-laps-table table')).toBeInTheDocument();
    expect(screen.getByText('Reading the speed of all laps…')).toBeInTheDocument();
  });

  it('puts_the_laps_of_a_long_race_in_columns_in_the_box', async () => {
    const laps = Array.from({ length: 20 }, (_, index) => ({ ...PANORAMA_LAPS[0]!, number: index + 1, pitIn: false, pitOut: false }));
    const chart = await openSpeed(lapsSpeed(1, 20, 4), raceDetail({ laps, lapsDone: 20, lapsInRace: 20, pitStops: 0, pitStopList: [], bestLap: 4 }));
    fireEvent.pointerEnter(chart);
    expect(box()).toHaveLength(20);
    expect((document.querySelector('.chart-box ul') as HTMLElement).style.getPropertyValue('--box-columns')).toBe('3');
  });
});

describe('race page, cursor on the position chart', () => {
  const POSITION = 'race-position';

  async function openCursor(distances: unknown = raceDistances()) {
    raceApi(raceDetail(), distances);
    renderApp({ path: `/races/${RACE_ID}` });
    return findEl('[data-chart="race-position"] .race-chart-plot');
  }

  function boxOf(name: string): string[] {
    const box = el(`[data-chart="${name}"] .race-chart-plot`).querySelector('.race-cursor-box');
    return box ? [...box.children].map(child => child.textContent ?? '') : [];
  }

  function cursorLine(): string {
    return document.querySelector('.race-position-cursor')!.textContent ?? '';
  }

  it('shows_no_box_on_load_and_says_where_the_cursor_is', async () => {
    await openCursor();
    expect(boxOf(POSITION)).toEqual([]);
    expect(boxOf('race-fuel')).toEqual([]);
    await waitFor(() => expect(cursorLine()).toBe('Cursor at lap 1, 0 m: position 20.'));
  });

  it('jumps_from_one_position_change_to_the_next_with_the_arrow_keys', async () => {
    const chart = await openCursor();
    await waitFor(() => expect(cursorLine()).toBe('Cursor at lap 1, 0 m: position 20.'));
    chart.focus();
    const user = userEvent.setup();
    await user.keyboard('{ArrowRight}');
    expect(boxOf(POSITION)).toEqual(['Lap 1 · 2,535 m', 'Position 15', '20 → 15 here']);
    expect(boxOf('race-fuel')).toEqual(['Lap 1 · 2,535 m', 'Fuel 87']);
    expect(cursorLine()).toBe('Cursor at lap 1, 2,535 m: position 15, up from 20.');
    await user.keyboard('{ArrowRight}');
    expect(boxOf(POSITION)).toEqual(['Lap 2 · 0 m', 'Position 9', '15 → 9 here']);
    await user.keyboard('{ArrowRight}');
    expect(boxOf(POSITION)).toEqual(['Lap 2 · 5,624 m', 'Position 11', '9 → 11 here']);
    expect(cursorLine()).toBe('Cursor at lap 2, 5,624 m: position 11, down from 9.');
    await user.keyboard('{ArrowLeft}');
    expect(boxOf(POSITION)).toEqual(['Lap 2 · 0 m', 'Position 9', '15 → 9 here']);
    await user.keyboard('{End}');
    expect(cursorLine()).toBe('Cursor at lap 7, 6,000 m: position 2.');
    await user.keyboard('{Home}');
    expect(cursorLine()).toBe('Cursor at lap 1, 0 m: position 20.');
  });

  it('snaps_to_a_position_change_within_12_px_and_hides_the_box_when_the_pointer_leaves', async () => {
    const chart = await openCursor();
    chart.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 220, right: 800, bottom: 220, x: 0, y: 0, toJSON: () => ({}) });
    const xOf = (tMs: number) => (tMs / 1_029_768) * 800;
    fireEvent.pointerEnter(chart, { pointerType: 'mouse' });
    fireEvent.pointerMove(chart, { pointerType: 'mouse', clientX: xOf(60_000) + 10 });
    expect(boxOf(POSITION)).toEqual(['Lap 1 · 2,535 m', 'Position 15', '20 → 15 here']);
    fireEvent.pointerMove(chart, { pointerType: 'mouse', clientX: xOf(200_000) });
    expect(boxOf(POSITION)).toEqual(['Lap 2 · 2,203 m', 'Position 9']);
    expect(cursorLine()).toBe('Cursor at lap 2, 2,203 m: position 9.');
    fireEvent.pointerLeave(chart, { pointerType: 'mouse' });
    expect(boxOf(POSITION)).toEqual([]);
  });

  it('keeps_the_box_when_a_finger_lifts', async () => {
    const chart = await openCursor();
    chart.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 220, right: 800, bottom: 220, x: 0, y: 0, toJSON: () => ({}) });
    fireEvent.pointerEnter(chart, { pointerType: 'touch' });
    fireEvent.pointerDown(chart, { pointerType: 'touch', clientX: (60_000 / 1_029_768) * 800 });
    fireEvent.pointerLeave(chart, { pointerType: 'touch' });
    expect(boxOf(POSITION)).toEqual(['Lap 1 · 2,535 m', 'Position 15', '20 → 15 here']);
    fireEvent.focus(chart);
    fireEvent.blur(chart);
    expect(boxOf(POSITION)).toEqual([]);
  });

  it('gives_the_lap_without_metres_when_the_recording_is_gone', async () => {
    const chart = await openCursor({ status: 409, body: { code: 'raw-missing' } });
    await waitFor(() => expect(cursorLine()).toBe('Cursor at lap 1: position 20.'));
    chart.focus();
    await userEvent.setup().keyboard('{ArrowRight}{ArrowRight}');
    expect(boxOf(POSITION)).toEqual(['Lap 2', 'Position 9', '15 → 9 here']);
    expect(cursorLine()).toBe('Cursor at lap 2: position 9, up from 15.');
  });
});

describe('lap colour tokens', () => {
  it('defines_10_lap_colours_in_the_light_and_both_dark_themes', () => {
    const css = readFileSync(join(import.meta.dirname, '../src/styles/tokens.css'), 'utf8');
    const blocks = [css.slice(0, css.indexOf('@media')), css.slice(css.indexOf('@media'), css.indexOf(":root[data-theme='dark']")), css.slice(css.indexOf(":root[data-theme='dark']"))];
    for (const block of blocks) for (let index = 0; index < 10; index++) expect(block).toMatch(new RegExp(`--lap-${index}: #[0-9a-f]{6};`));
  });
});
