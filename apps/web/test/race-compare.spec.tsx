import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { RaceDetail } from '@gt7/contracts';
import { RING_ID, raceCompare, ringDetail } from './race-fixtures.ts';
import { ApiStub, renderApp, setViewportWidth, signedIn } from './support.tsx';

const COMPARE_PATH = `/api/races/${RING_ID}/compare`;
const MAP_NAME = /^Map of the line of lap \d+ and the line of lap \d+$/;

function compareApi(detail: RaceDetail = ringDetail(), reply: (url: URL) => unknown = url => raceCompare({ lap: Number(url.searchParams.get('lap')), withLap: Number(url.searchParams.get('with') ?? 2) })): ApiStub {
  return signedIn(new ApiStub())
    .on(`GET /api/races/${RING_ID}`, detail)
    .on(`GET ${COMPARE_PATH}`, (_body: unknown, url: URL) => reply(url))
    .install();
}

function compareCalls(api: ApiStub): string[] {
  return api.calls.filter(call => call.path === COMPARE_PATH).map(call => call.path);
}

async function openCompare(search = '?lap=5&with=2', detail?: RaceDetail, reply?: (url: URL) => unknown) {
  const api = compareApi(detail, reply);
  renderApp({ path: `/races/${RING_ID}/compare${search}` });
  await screen.findByRole('heading', { level: 2, name: /^Lap \d/ });
  return api;
}

describe('race page, compare tab', () => {
  it('says_the_gap_in_one_sentence_in_red_for_a_slower_lap', async () => {
    await openCompare();
    const heading = screen.getByRole('heading', { level: 2, name: 'Lap 5 is 1.713 s slower than lap 2' });
    expect(within(heading).getByText('1.713 s slower')).toHaveClass('slower');
    expect(screen.queryByText(/^Gap to lap/)).not.toBeInTheDocument();
    expect(heading).not.toHaveTextContent('1:19.336');
    expect(screen.queryByRole('link', { name: 'All laps' })).not.toBeInTheDocument();
    expect(heading.parentElement!.firstElementChild).toBe(heading);
    expect(within(screen.getByRole('navigation', { name: 'Race' })).getByRole('link', { name: 'Compare' })).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByRole('region', { name: 'Lexus RC F Gr.4' })).not.toBeInTheDocument();
  });

  it('says_the_gap_in_green_for_a_faster_lap', async () => {
    await openCompare('?lap=3&with=4');
    const heading = screen.getByRole('heading', { level: 2, name: 'Lap 3 is 0.443 s faster than lap 4' });
    expect(within(heading).getByText('0.443 s faster')).toHaveClass('faster');
  });

  it('says_when_two_laps_have_the_same_time', async () => {
    const detail = ringDetail();
    const laps = detail.laps.map(lap => (lap.number === 5 ? { ...lap, timeMs: detail.laps[3]!.timeMs } : lap));
    await openCompare('?lap=5&with=4', { ...detail, laps }, () => raceCompare({ lap: 5, withLap: 4 }));
    const heading = screen.getByRole('heading', { level: 2, name: 'Lap 5 has the same time as lap 4.' });
    expect(heading.querySelector('.race-gap-word')).toBeNull();
  });

  it('puts_the_selects_without_visible_labels_in_the_heading_row', async () => {
    await openCompare();
    const lap = await screen.findByRole('combobox', { name: 'Lap' });
    const withLap = screen.getByRole('combobox', { name: 'Compare with' });
    for (const select of [lap, withLap]) expect(document.querySelector(`label[for="${select.id}"]`)).toHaveClass('visually-hidden');
    const head = screen.getByRole('heading', { level: 2, name: 'Lap 5 is 1.713 s slower than lap 2' }).closest('.race-compare-head')!;
    expect(head).toContainElement(lap);
    expect(head).toContainElement(withLap);
  });

  it('phone_has_no_back_button', async () => {
    setViewportWidth(390);
    await openCompare();
    expect(screen.queryByRole('link', { name: 'All laps' })).not.toBeInTheDocument();
    expect(document.querySelector('.race-back')).toBeNull();
  });

  it('uses_the_words_of_the_two_laps', async () => {
    await openCompare();
    expect(await screen.findByRole('region', { name: 'Map of the line of lap 2 and the line of lap 5' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'The two lines' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Map of the line of lap 2 and the line of lap 5' }).querySelector('h2')).toBeNull();
    expect(screen.getByRole('button', { name: 'View the map in full screen' })).toBeInTheDocument();
    expect(screen.getAllByText('lap 2, best').length).toBeGreaterThan(0);
    expect(screen.getAllByText('lap 5').length).toBeGreaterThan(0);
    expect(screen.getByRole('slider', { name: 'Time lost to lap 2, s' })).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'Speed, km/h' }).closest('.channel')!.querySelector('.channel-label span:last-child')!.textContent).toMatch(/^lap 2 \d+, lap 5 \d+$/);
    expect(screen.queryByRole('slider', { name: 'Distance from the reference line, m' })).not.toBeInTheDocument();
    expect(screen.getByText('Cursor at 0 m of 20 m.')).toBeInTheDocument();
    expect(screen.queryByText('Drive again')).not.toBeInTheDocument();
    expect(screen.queryByText('Use this attempt as a reference')).not.toBeInTheDocument();
    expect(screen.queryByText('Delete attempt')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Corners' })).not.toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Side distance on the map' })).toBeInTheDocument();
  });

  it('holds_each_chart_in_a_field_with_its_name_unit_and_readout', async () => {
    await openCompare();
    await screen.findByRole('region', { name: MAP_NAME });
    const fields = [
      ['Speed, km/h', 'Speed', 'km/h'],
      ['Throttle', 'Throttle', null],
      ['Brake', 'Brake', null],
      ['Time lost to lap 2, s', 'Time lost to lap 2', 's']
    ] as const;
    for (const [name, title, unit] of fields) {
      const field = screen.getByRole('slider', { name }).closest('.chart-field')!;
      expect(field.querySelector('.field-title')!.textContent, name).toBe(title);
      expect(field.querySelector('.field-unit')?.textContent ?? null, name).toBe(unit);
      expect(field.querySelector('.channel-label span:last-child')!.textContent, name).not.toBe('');
    }
    const throttleTicks = [...screen.getByRole('slider', { name: 'Throttle' }).closest('.chart-field')!.querySelectorAll('.y-axis span')].map(span => span.textContent);
    expect(throttleTicks).toEqual(['0%', '50%', '100%']);
    const legend = document.querySelector('.side-legend')!;
    expect(legend.closest('.chart-field')).toBeNull();
    expect(legend.nextElementSibling).toHaveClass('chart-field');
    expect(legend.closest('.channel')!.querySelector('[data-chart="time"]')).not.toBeNull();
  });

  it('groups_the_differences_by_turn_with_no_difference_and_an_even_turn', async () => {
    await openCompare();
    const list = await screen.findByRole('region', { name: 'Differences by turn' });
    expect(list).toHaveTextContent('Turns in the order of the lap. Time lost is measured from telemetry. Lap 2 is one of your laps, not the best possible line.');
    const groups = within(list).getAllByRole('group');
    expect(groups.map(group => group.getAttribute('aria-label'))).toEqual(['T1 · 0.40 s lost', 'T2 · 0.00 s', 'T3 · 0.46 s gained']);
    expect(groups[0]).toHaveTextContent('Braked 70 m earlier');
    expect(groups[0]).toHaveTextContent('16 km/h slower in the corner');
    expect(groups[1]).toHaveTextContent('No difference');
    expect(groups[1]!.querySelector('.turn-even')).not.toBeNull();
    expect(within(list).queryByRole('radio', { name: 'Time lost' })).not.toBeInTheDocument();
  });

  it('selects_change_the_address_and_load_again', async () => {
    const api = await openCompare();
    const lap = await screen.findByRole('combobox', { name: 'Lap' });
    const withLap = screen.getByRole('combobox', { name: 'Compare with' });
    expect([...lap.querySelectorAll('option')].map(option => option.textContent)).toEqual(['Lap 1 · 1:23.585', 'Lap 3 · 1:18.765', 'Lap 4 · 1:19.208', 'Lap 5 · 1:19.336']);
    expect([...withLap.querySelectorAll('option')].map(option => option.textContent)).toEqual(['Lap 1 · 1:23.585', 'Lap 2 · 1:17.623', 'Lap 3 · 1:18.765', 'Lap 4 · 1:19.208']);
    await userEvent.selectOptions(lap, 'Lap 4 · 1:19.208');
    await waitFor(() => expect(window.location.search).toBe('?lap=4&with=2'));
    await waitFor(() => expect(compareCalls(api)).toHaveLength(2));
    expect(await screen.findByRole('heading', { level: 2, name: 'Lap 4 is 1.585 s slower than lap 2' })).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Compare with' }), 'Lap 3 · 1:18.765');
    await waitFor(() => expect(window.location.search).toBe('?lap=4&with=3'));
    expect(await screen.findByRole('heading', { level: 2, name: 'Lap 4 is 0.443 s slower than lap 3' })).toBeInTheDocument();
    const last = api.calls.filter(call => call.path === COMPARE_PATH).at(-1)!;
    expect(last).toBeDefined();
  });

  it('compares_the_last_lap_that_is_not_the_reference_lap_by_default', async () => {
    let asked = '';
    await openCompare('', ringDetail(), url => {
      asked = url.search;
      return raceCompare();
    });
    expect(screen.getByRole('heading', { level: 2, name: 'Lap 5 is 1.713 s slower than lap 2' })).toBeInTheDocument();
    expect(asked).toBe('?lap=5');
    expect(await screen.findByRole('combobox', { name: 'Compare with' })).toHaveValue('2');
  });

  it('takes_the_lap_before_when_the_last_lap_is_the_reference_lap', async () => {
    let asked = '';
    await openCompare('', ringDetail({ referenceLap: 5, bestLap: 5 }), url => {
      asked = url.search;
      return raceCompare({ lap: 4, withLap: 5 });
    });
    expect(asked).toBe('?lap=4');
  });

  it('says_that_a_race_of_one_lap_has_nothing_to_compare', async () => {
    const one = ringDetail();
    const api = compareApi({ ...one, laps: one.laps.slice(0, 1), lapsDone: 1, complete: false, bestLap: 1, bestLapMs: 83_585, referenceLap: 1 });
    renderApp({ path: `/races/${RING_ID}/compare` });
    expect(await screen.findByText('This race has one lap. There is no other lap to compare.')).toBeInTheDocument();
    expect(compareCalls(api)).toHaveLength(0);
    expect(screen.queryByRole('slider')).not.toBeInTheDocument();
  });

  it.each([
    ['raw-missing', 'The recording of this race is no longer on the disk. The lap table stays.'],
    ['no-match', 'These two laps do not match. Choose another lap.']
  ])('shows_the_%s_text_and_keeps_the_selects', async (code, text) => {
    await openCompare('?lap=5&with=2', ringDetail(), () => ({ status: 409, body: { code, reason: 'Server text.' } }));
    expect(await screen.findByText(text)).toBeInTheDocument();
    expect(await screen.findByRole('combobox', { name: 'Lap' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Compare with' })).toBeInTheDocument();
    expect(screen.queryByRole('slider')).not.toBeInTheDocument();
  });

  it('explains_the_pit_lane_gap_and_keeps_the_option_text_short', async () => {
    const detail = ringDetail();
    const laps = detail.laps.map(lap => (lap.number === 3 ? { ...lap, pitOut: true, closed: false } : lap));
    await openCompare('?lap=3&with=2', { ...detail, laps }, () => raceCompare({ lap: 3, withLap: 2 }));
    await screen.findByRole('combobox', { name: 'Lap' });
    expect([...screen.getByRole('combobox', { name: 'Compare with' }).querySelectorAll('option')].map(option => option.textContent)).toContain('Lap 2 · 1:17.623');
    expect([...screen.getByRole('combobox', { name: 'Lap' }).querySelectorAll('option')].map(option => option.textContent)).toContain('Lap 3 · 1:18.765');
    expect(await screen.findByText('A gap in the line is the pit lane.')).toBeInTheDocument();
  });

  it.each([
    ['?lap=3&with=2', { pitOut: true }, 'This lap starts in the pit lane. The curve starts at the pit exit.'],
    ['?lap=5&with=3', { pitOut: true }, 'Lap 3 starts in the pit lane. The curve starts at the pit exit.'],
    ['?lap=3&with=2', { pitIn: true }, 'The rest of the gap is in the pit lane.'],
    ['?lap=5&with=3', { pitIn: true }, 'The rest of the gap is in the pit lane.'],
    ['?lap=3&with=2', { pitIn: true, pitOut: true }, 'The curve starts at the pit exit. The rest of the gap is in the pit lane.']
  ] as const)('says_under_the_time_chart_where_the_curve_of_a_pit_lap_starts_or_ends %s %o', async (search, flags, text) => {
    const detail = ringDetail();
    const laps = detail.laps.map(lap => (lap.number === 3 ? { ...lap, ...flags } : lap));
    const [lap, withLap] = [...new URLSearchParams(search).values()].map(Number);
    await openCompare(search, { ...detail, laps }, () => raceCompare({ lap: lap!, withLap: withLap! }));
    const note = await screen.findByText(text);
    expect(note.previousElementSibling!.querySelector('[data-chart="time"]')).not.toBeNull();
  });

  it('names_both_out_laps', async () => {
    const detail = ringDetail();
    const laps = detail.laps.map(lap => (lap.number === 3 || lap.number === 5 ? { ...lap, pitOut: true, closed: false } : lap));
    await openCompare('?lap=3&with=5', { ...detail, laps }, () => raceCompare({ lap: 3, withLap: 5 }));
    expect(await screen.findByText('This lap and lap 5 start in the pit lane. The curve starts at the pit exit.')).toBeInTheDocument();
  });

  it('has_no_pit_note_without_a_pit_lap', async () => {
    await openCompare();
    await screen.findByRole('region', { name: MAP_NAME });
    expect(screen.queryByText('A gap in the line is the pit lane.')).not.toBeInTheDocument();
    expect(screen.queryByText(/pit lane\. The curve|The rest of the gap/)).not.toBeInTheDocument();
  });

  it('phone_shows_head_selects_map_differences_charts_and_no_scale_switch', async () => {
    setViewportWidth(390);
    await openCompare();
    const map = await screen.findByRole('region', { name: MAP_NAME });
    const select = await screen.findByRole('combobox', { name: 'Lap' });
    const differences = screen.getByRole('region', { name: 'Differences by turn' });
    const speed = screen.getByRole('slider', { name: 'Speed, km/h' });
    expect(select.compareDocumentPosition(map) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(map.compareDocumentPosition(differences) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(differences.compareDocumentPosition(speed) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Side distance on the map' })).not.toBeInTheDocument();
  });

  it('names_the_line_of_the_other_lap_in_an_off_line_difference', async () => {
    await openCompare('?lap=5&with=2', ringDetail(), () => raceCompare({ findings: [{ kind: 'off-line', eventKey: null, sM: 16, size: 4.2, unit: 'm', turn: 2 }] }));
    const list = await screen.findByRole('region', { name: 'Differences by turn' });
    expect(list).toHaveTextContent('Up to 4 m from the line of lap 2');
    expect(list).not.toHaveTextContent('reference line');
  });

  it('names_the_lap_in_the_map_view', async () => {
    await openCompare();
    await userEvent.click(await screen.findByRole('button', { name: 'View the map in full screen' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Line of lap 2, 20 m.');
    expect(dialog).toHaveTextContent('Select a difference to find it on lap 5.');
    expect(within(dialog).getByRole('img', { name: 'Line of lap 2 and line of lap 5 of High Speed Ring' })).toBeInTheDocument();
  });

  it('writes_every_length_in_the_map_view_with_a_thousands_separator', async () => {
    await openCompare('?lap=5&with=2', ringDetail(), () => raceCompare({ lengthM: 6181, findings: [{ kind: 'off-line', eventKey: null, sM: 1234, size: 4.2, unit: 'm', turn: 2 }] }));
    await userEvent.click(await screen.findByRole('button', { name: 'View the map in full screen' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Line of lap 2, 6,181 m.');
    expect(within(dialog).getByText('1,234 m')).toBeInTheDocument();
  });

  it('marks_the_lap_line_on_the_map_and_in_the_map_view', async () => {
    await openCompare();
    const panel = await screen.findByRole('region', { name: MAP_NAME });
    expect([...panel.querySelectorAll('.track-label')].map(node => node.textContent)).toEqual(['lap line']);
    expect(panel.querySelector('.track-finish')).toBeNull();
    await userEvent.click(within(panel).getByRole('button', { name: 'View the map in full screen' }));
    expect([...screen.getByRole('dialog').querySelectorAll('.track-label')].map(node => node.textContent)).toEqual(['lap line']);
  });

  it('keeps_start_and_finish_when_the_other_lap_has_a_pit_stop', async () => {
    const detail = ringDetail();
    const laps = detail.laps.map(lap => (lap.number === 3 ? { ...lap, pitOut: true, closed: false } : lap));
    await openCompare('?lap=5&with=3', { ...detail, laps }, () => raceCompare({ lap: 5, withLap: 3 }));
    const panel = await screen.findByRole('region', { name: MAP_NAME });
    expect([...panel.querySelectorAll('.track-label')].map(node => node.textContent)).toEqual(['start', 'finish']);
  });

  it('keeps_start_and_finish_when_the_server_says_that_the_other_lap_is_not_closed', async () => {
    const detail = ringDetail();
    const laps = detail.laps.map(lap => (lap.number === 2 ? { ...lap, closed: false } : lap));
    await openCompare('?lap=5&with=2', { ...detail, laps }, () => raceCompare({ lap: 5, withLap: 2 }));
    const panel = await screen.findByRole('region', { name: MAP_NAME });
    expect([...panel.querySelectorAll('.track-label')].map(node => node.textContent)).toEqual(['start', 'finish']);
  });

  it('keeps_start_and_finish_when_the_other_lap_is_lap_1', async () => {
    await openCompare('?lap=5&with=1', undefined, () => raceCompare({ lap: 5, withLap: 1 }));
    const panel = await screen.findByRole('region', { name: MAP_NAME });
    expect([...panel.querySelectorAll('.track-label')].map(node => node.textContent)).toEqual(['start', 'finish']);
  });

  it('calls_a_difference_outside_the_turns_whole_lap', async () => {
    await openCompare('?lap=5&with=2', ringDetail(), () => raceCompare({ findings: [{ kind: 'brake-late', eventKey: 'brake@3', sM: 3, size: 12, unit: 'm', turn: null }], turnLosses: [] }));
    const list = await screen.findByRole('region', { name: 'Differences by turn' });
    expect(within(list).getAllByRole('group').map(group => group.getAttribute('aria-label'))).toEqual(['Whole lap']);
  });

  it('moves_the_cursor_to_a_selected_difference', async () => {
    await openCompare();
    const list = await screen.findByRole('region', { name: 'Differences by turn' });
    await userEvent.click(within(list).getByRole('button', { name: /Braked 70 m earlier/ }));
    expect(screen.getByRole('slider', { name: 'Speed, km/h' })).toHaveAttribute('aria-valuenow', '10');
  });
});

describe('laps tab hint', () => {
  it('names_the_reference_lap_when_it_is_not_the_best_lap', async () => {
    const detail = ringDetail({ referenceLap: 3 });
    signedIn(new ApiStub()).on(`GET /api/races/${RING_ID}`, detail).on(`GET /api/races/${RING_ID}/speed`, { status: 409, body: { code: 'raw-missing' } }).install();
    renderApp({ path: `/races/${RING_ID}` });
    expect(await screen.findByText('Select a lap to compare it with lap 3, the best lap without a pit stop.')).toBeInTheDocument();
    expect(screen.queryByText('Select a lap to compare it with the best lap.')).not.toBeInTheDocument();
  });
});

