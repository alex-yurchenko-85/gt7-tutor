import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { RaceDetail } from '@gt7/contracts';
import { PANORAMA_LAPS, RACE_ID, lapsSpeed, raceDetail, raceDistances } from './race-fixtures.ts';
import { ApiStub, renderApp, setViewportWidth, signedIn } from './support.tsx';

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
  return within(screen.getByRole('table', { name: 'Laps' })).getAllByRole('row').slice(1);
}

describe('race page, laps tab', () => {
  it('shows_the_head_with_breadcrumb_name_and_tabs', async () => {
    await openRace();
    expect(screen.getByRole('heading', { level: 1, name: 'Mount Panorama' })).toBeInTheDocument();
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(crumbs).getByRole('link', { name: 'Races' })).toHaveAttribute('href', '/races');
    expect(crumbs).toHaveTextContent(/^Races \/ Mount Panorama$/);
    expect(screen.getByText(/^20 Nov 2026, 17:36 · lap length 6,165 m$/)).toBeInTheDocument();
    expect(screen.queryByText(/Track name from the lap length/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change the name' })).toBeInTheDocument();
    const tabs = screen.getByRole('navigation', { name: 'Race' });
    expect(within(tabs).getAllByRole('link').map(link => [link.textContent, link.getAttribute('href')])).toEqual([
      ['Laps', `/races/${RACE_ID}`],
      ['Compare', `/races/${RACE_ID}/compare`],
      ['Off the track', `/races/${RACE_ID}/off-track`]
    ]);
    expect(within(tabs).getByRole('link', { name: 'Laps' })).toHaveAttribute('aria-current', 'page');
    expect(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', { name: 'Races' })).toHaveAttribute('aria-current', 'page');
  });

  it('shows_the_band_with_the_car_the_facts_and_three_values', async () => {
    await openRace();
    const band = screen.getByRole('region', { name: "BAC Mono '16" });
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
    expect(cells[0]!.querySelector('.race-off-part')).toHaveAccessibleName('1 time two or three wheels off');
    expect(cells[2]!.querySelector('.race-off-all')).toHaveAccessibleName('1 time all four wheels off the track');
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
    expect(within(pit).getByText('Pit stop after lap 2: 35.48 s in the pit lane, fuel 38 to 100.')).toHaveClass('visually-hidden');
    expect(pit.querySelector('[aria-hidden="true"]')?.textContent).toBe('PIT STOP35.48 s in the pit laneFuel 38 → 100');
    expect(rows[6]).toHaveTextContent('38.19 s in the pit lane');
    expect(rows.map(row => row.querySelector('.race-lap-number')?.textContent ?? 'pit')).toEqual(['1', '2', 'pit', '3', '4', '5', 'pit', '6', '7']);
  });

  it('says_how_to_compare_and_explains_the_marks', async () => {
    await openRace();
    expect(screen.getByText('Select a lap to compare it with the best lap.')).toBeInTheDocument();
    expect(screen.getByText('all four wheels off the track')).toBeInTheDocument();
    expect(screen.getByText('two or three wheels off')).toBeInTheDocument();
  });

  it('shows_position_and_fuel_charts_with_their_headings', async () => {
    await openRace();
    expect(screen.getByRole('heading', { level: 2, name: 'Laps' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Position in the race' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Fuel' })).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'Position in the race, lap by lap' }).closest('.race-chart')!).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'Fuel, lap by lap' }).closest('.race-chart')!).toBeInTheDocument();
    expect(screen.queryByText('pit stop')).not.toBeInTheDocument();
    expect(screen.queryByText('Numbers under the chart: laps')).not.toBeInTheDocument();
    for (const name of ['Position in the race, lap by lap', 'Fuel, lap by lap']) {
      const figure = screen.getByRole('slider', { name }).closest('.race-chart')!;
      expect(figure).toHaveClass('chart-field');
      expect([...figure.querySelectorAll('.axis-pit')].map(label => label.textContent)).toEqual(['P1', 'P2']);
      expect(figure.querySelector('.axis-name')!.textContent).toBe('lap');
    }
    const position = screen.getByRole('slider', { name: 'Position in the race, lap by lap' }).closest('.race-chart')!;
    expect([...position.querySelectorAll('.y-axis .axis-bold')].map(label => label.textContent)).toEqual(['20', '2']);
    expect([...position.querySelectorAll('.y-axis span')].map(label => label.textContent)).not.toContain('1');
    const plot = screen.getByRole('slider', { name: 'Fuel, lap by lap' }).closest('.race-chart')!.querySelector('svg')!;
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
    expect(screen.getByRole('region', { name: "BAC Mono '16" })).toHaveTextContent('7 laps · 20 cars');
    expect(screen.getByRole('region', { name: "BAC Mono '16" })).not.toHaveTextContent('pit stop');
  });

  it('shows_a_race_that_is_not_finished_with_its_laps_and_captions', async () => {
    const laps = PANORAMA_LAPS.slice(4).map(lap => ({ ...lap, pitIn: false, pitOut: lap.number === 5 }));
    await openRace(raceDetail({ complete: false, firstLap: 5, lapsDone: 3, startPosition: 3, pitStops: 0, pitStopList: [], laps, bestLap: 7, bestLapMs: 140_305, raceMs: 451_670 }));
    const band = screen.getByRole('region', { name: "BAC Mono '16" });
    expect(band).toHaveTextContent('laps 5 to 7 of 7, not finished · 20 cars');
    expect(bandValues()).toEqual(['7:31.670time of the recorded laps', '2:20.305best lap · lap 7', '3 → 2position, laps 5 to 7']);
    const rows = lapRows();
    expect(rows.map(row => row.querySelector('.race-lap-number')?.textContent)).toEqual(['5', '6', '7']);
    expect(rows[0]).toHaveTextContent('out of the pit lane');
    expect(within(screen.getByRole('slider', { name: 'Position in the race, lap by lap' }).closest('.race-chart')!.parentElement!).getAllByText(/^[0-9]$/).map(label => label.textContent)).toContain('5');
  });

  it('says_3_of_7_laps_for_a_race_stopped_after_lap_3', async () => {
    await openRace(raceDetail({ complete: false, lapsDone: 3, laps: PANORAMA_LAPS.slice(0, 3), pitStops: 1, pitStopList: [raceDetail().pitStopList[0]!], bestLap: 3, bestLapMs: 139_931, raceMs: 439_813, finishPosition: 6 }));
    expect(screen.getByRole('region', { name: "BAC Mono '16" })).toHaveTextContent('3 of 7 laps, not finished · 20 cars · 1 pit stop');
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
    let dialog = screen.getByRole('dialog', { name: 'Name the track' });
    const choices = within(dialog).getByRole('radiogroup', { name: 'Track' });
    expect(within(choices).getAllByRole('radio').map(radio => radio.textContent)).toEqual(['High Speed Ring', 'High Speed Ring Reverse', 'Another name']);
    expect(within(choices).getByRole('radio', { name: 'High Speed Ring' })).toHaveAttribute('aria-checked', 'true');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(api.called(`PATCH /api/races/${RACE_ID}`)).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Name the track' }));
    dialog = screen.getByRole('dialog', { name: 'Name the track' });
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
    const dialog = screen.getByRole('dialog', { name: 'Name the track' });
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
    const dialog = screen.getByRole('dialog', { name: 'Name the track' });
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
    expect(rows[2]!.querySelector('[aria-hidden="true"]')?.textContent).toBe('PIT STOP35.48 sFuel 38 → 100');
  });

  it('shows_not_found_for_an_unknown_race', async () => {
    signedIn(new ApiStub()).on(`GET /api/races/${RACE_ID}`, { status: 404, body: { code: 'race-not-found' } }).install();
    renderApp({ path: `/races/${RACE_ID}` });
    expect(await screen.findByRole('heading', { level: 1, name: 'This race is not here' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Races' })).toHaveAttribute('href', '/races');
  });
});

describe('race page, speed of all laps', () => {
  const LABEL = 'Speed, km/h, over the distance from the lap line';

  async function openSpeed(speed: unknown = lapsSpeed(), detail: RaceDetail = raceDetail()) {
    signedIn(new ApiStub()).on(`GET /api/races/${RACE_ID}`, detail).on(`GET /api/races/${RACE_ID}/speed`, speed).install();
    renderApp({ path: `/races/${RACE_ID}` });
    return screen.findByRole('slider', { name: LABEL });
  }

  function readout(): string {
    return document.querySelector('[data-chart="race-speed"]')!.closest('.channel')!.querySelector('.channel-label span:last-child')!.textContent ?? '';
  }

  function box(): string[] {
    return [...document.querySelectorAll('.speed-box li')].map(item => item.textContent ?? '');
  }

  it('draws_one_line_per_lap_with_the_best_lap_in_blue', async () => {
    const chart = await openSpeed();
    expect(screen.getByRole('heading', { level: 2, name: 'Speed, all laps' })).toBeInTheDocument();
    expect(chart.querySelectorAll('[data-series="ref"]')).toHaveLength(1);
    expect(chart.querySelectorAll('[data-series="lap"]')).toHaveLength(6);
    expect([...chart.querySelectorAll('.chart-band')].map(band => band.getAttribute('data-band'))).toEqual(['T1', 'T2']);
    expect(screen.getByText('best lap, lap 4')).toBeInTheDocument();
    expect(screen.getByText('other laps')).toBeInTheDocument();
    expect(screen.getByText('turn')).toBeInTheDocument();
    const field = chart.closest('.chart-field')!;
    expect(screen.getByText(LABEL)).toHaveClass('visually-hidden');
    expect(field.querySelector('.field-title')).toBeNull();
    expect(field.querySelector('.field-unit')!.textContent).toBe('km/h');
    expect(field.querySelector('.distance-axis .axis-start')!.textContent).toBe('0 m');
  });

  it('gives_the_readout_the_box_and_the_cursor_line', async () => {
    const chart = await openSpeed();
    expect(readout()).toBe('at 0 m: best lap 148, other laps 140 to 152');
    expect(document.querySelector('.speed-box')).toBeNull();
    fireEvent.pointerEnter(chart);
    expect(document.querySelector('.speed-box-title')?.textContent).toBe('0 m');
    expect(box()).toEqual(['Lap 4, best: 148 km/h', 'Lap 1: 140 km/h', 'Lap 2: 142 km/h', 'Lap 3: no data', 'Lap 5: 148 km/h', 'Lap 6: 150 km/h', 'Lap 7: 152 km/h']);
    expect(screen.getByText('Cursor at 0 m of 6,165 m.')).toBeInTheDocument();
    expect(screen.getByText('Move the pointer or a finger across a chart, or focus a chart and use the arrow keys.')).toBeInTheDocument();
  });

  it('moves_the_cursor_with_the_keyboard_and_names_the_turn', async () => {
    const chart = await openSpeed();
    chart.focus();
    const user = userEvent.setup();
    await user.keyboard('{End}');
    expect(chart).toHaveAttribute('aria-valuenow', '6165');
    expect(screen.getByText('Cursor at 6,165 m of 6,165 m.')).toBeInTheDocument();
    expect(readout()).toBe('at 6,165 m: best lap 148, other laps 140 to 152');
    expect(box()).toContain('Lap 2: no data');
    await user.keyboard('{Home}');
    for (let step = 0; step < 52; step++) await user.keyboard('{PageUp}');
    expect(chart).toHaveAttribute('aria-valuenow', '5200');
    await user.keyboard('{Home}{PageUp}{PageUp}{PageUp}{PageUp}{PageUp}{PageUp}');
    expect(chart).toHaveAttribute('aria-valuenow', '600');
    expect(document.querySelector('.speed-box-title')?.textContent).toBe('600 m · T1');
  });

  it('keeps_the_box_inside_the_plot_at_both_ends', async () => {
    const chart = await openSpeed();
    act(() => chart.focus());
    expect(document.querySelector('.speed-box')).toHaveClass('right');
    await userEvent.setup().keyboard('{End}');
    expect(document.querySelector('.speed-box')).toHaveClass('left');
  });

  it('shows_the_box_only_while_the_pointer_is_over_the_chart_or_the_chart_has_focus', async () => {
    const chart = await openSpeed();
    expect(document.querySelector('.speed-box')).toBeNull();
    fireEvent.pointerEnter(chart);
    expect(document.querySelector('.speed-box')).not.toBeNull();
    fireEvent.pointerLeave(chart);
    expect(document.querySelector('.speed-box')).toBeNull();
    expect(readout()).toBe('at 0 m: best lap 148, other laps 140 to 152');
    expect(screen.getByText('Cursor at 0 m of 6,165 m.')).toBeInTheDocument();
    fireEvent.focus(chart);
    expect(document.querySelector('.speed-box')).not.toBeNull();
    fireEvent.blur(chart);
    expect(document.querySelector('.speed-box')).toBeNull();
    fireEvent.pointerEnter(chart);
    act(() => chart.focus());
    fireEvent.pointerLeave(chart);
    expect(document.querySelector('.speed-box')).toBeNull();
    fireEvent.keyDown(chart, { key: 'ArrowRight' });
    expect(document.querySelector('.speed-box')).not.toBeNull();
  });

  it('has_no_box_on_a_phone', async () => {
    setViewportWidth(390);
    const chart = await openSpeed();
    fireEvent.pointerEnter(chart);
    expect(document.querySelector('.speed-box')).toBeNull();
    expect(readout()).toBe('at 0 m: best lap 148, other laps 140 to 152');
  });

  it('names_the_laps_of_the_game_for_a_race_from_lap_5', async () => {
    const laps = PANORAMA_LAPS.slice(4).map(lap => ({ ...lap, pitIn: false, pitOut: false }));
    const chart = await openSpeed(lapsSpeed(5, 3, 7), raceDetail({ complete: false, firstLap: 5, lapsDone: 3, pitStops: 0, pitStopList: [], laps, bestLap: 7, bestLapMs: 140_305, referenceLap: 7, raceMs: 451_670 }));
    fireEvent.pointerEnter(chart);
    expect(screen.getByText('best lap, lap 7')).toBeInTheDocument();
    expect(box()).toEqual(['Lap 7, best: 148 km/h', 'Lap 5: 140 km/h', 'Lap 6: 142 km/h']);
  });

  it('says_the_recording_is_gone_and_keeps_the_table', async () => {
    signedIn(new ApiStub())
      .on(`GET /api/races/${RACE_ID}`, raceDetail())
      .on(`GET /api/races/${RACE_ID}/speed`, { status: 409, body: { code: 'raw-missing' } })
      .install();
    renderApp({ path: `/races/${RACE_ID}` });
    expect(await screen.findByText('The recording of this race is no longer on the disk. The lap table stays.')).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Laps' })).toBeInTheDocument();
    expect(screen.queryByRole('slider', { name: LABEL })).not.toBeInTheDocument();
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
    expect(await screen.findByRole('table', { name: 'Laps' })).toBeInTheDocument();
    expect(screen.getByText('Reading the speed of all laps…')).toBeInTheDocument();
  });

  it('puts_the_laps_of_a_long_race_in_columns_in_the_box', async () => {
    const laps = Array.from({ length: 20 }, (_, index) => ({ ...PANORAMA_LAPS[0]!, number: index + 1, pitIn: false, pitOut: false }));
    const chart = await openSpeed(lapsSpeed(1, 20, 4), raceDetail({ laps, lapsDone: 20, lapsInRace: 20, pitStops: 0, pitStopList: [], bestLap: 4 }));
    fireEvent.pointerEnter(chart);
    expect(box()).toHaveLength(20);
    expect(document.querySelector('.speed-box ul')).toHaveStyle({ columnCount: '3' });
  });
});

describe('race page, cursor on the position chart', () => {
  const POSITION = 'Position in the race, lap by lap';

  async function openCursor(distances: unknown = raceDistances()) {
    raceApi(raceDetail(), distances);
    renderApp({ path: `/races/${RACE_ID}` });
    return screen.findByRole('slider', { name: POSITION });
  }

  function boxOf(name: string): string[] {
    const box = screen.getByRole('slider', { name }).querySelector('.race-cursor-box');
    return box ? [...box.children].map(child => child.textContent ?? '') : [];
  }

  function cursorLine(): string {
    return document.querySelector('.race-position-cursor')!.textContent ?? '';
  }

  it('shows_no_box_on_load_and_says_where_the_cursor_is', async () => {
    await openCursor();
    expect(boxOf(POSITION)).toEqual([]);
    expect(boxOf('Fuel, lap by lap')).toEqual([]);
    await waitFor(() => expect(cursorLine()).toBe('Cursor at lap 1, 0 m: position 20.'));
  });

  it('jumps_from_one_position_change_to_the_next_with_the_arrow_keys', async () => {
    const chart = await openCursor();
    await waitFor(() => expect(cursorLine()).toBe('Cursor at lap 1, 0 m: position 20.'));
    chart.focus();
    const user = userEvent.setup();
    await user.keyboard('{ArrowRight}');
    expect(boxOf(POSITION)).toEqual(['Lap 1 · 2,535 m', 'Position 15', '20 → 15 here']);
    expect(boxOf('Fuel, lap by lap')).toEqual(['Lap 1 · 2,535 m', 'Fuel 87']);
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

  it('names_the_chart_once_for_a_screen_reader', async () => {
    const chart = await openCursor();
    expect(chart.closest('.race-chart')).not.toHaveAttribute('role');
    expect(screen.queryByRole('group', { name: POSITION })).not.toBeInTheDocument();
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

