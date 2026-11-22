import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { RaceDetail } from '@gt7/contracts';
import { RING_ID, raceCompare, ringDetail } from './race-fixtures.ts';
import { ApiStub, renderApp, setViewportWidth, signedIn, el, maybeEl, findEl, sectionOf, maybeSection, findSection, els, findEls, turnGroupName } from './support.tsx';

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
    expect(within(el('nav.exercise-tabs')).getByRole('link', { name: 'Compare' })).toHaveAttribute('aria-current', 'page');
    expect(maybeSection('Lexus RC F Gr.4')).not.toBeInTheDocument();
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
    const lap = (await findEls('.race-compare-selects select'))[0]!;
    const withLap = els('.race-compare-selects select')[1]!;
    expect(document.querySelector('.race-compare-selects label')).toBeNull();
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
    expect(await findEl('section.map-panel')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'The two lines' })).not.toBeInTheDocument();
    expect(el('section.map-panel').querySelector('h2')).toBeNull();
    expect(screen.getByRole('button', { name: 'View' })).toBeInTheDocument();
    expect(screen.getAllByText('lap 2').length).toBeGreaterThan(0);
    expect(screen.queryByText(/^lap \d+, best$/)).not.toBeInTheDocument();
    expect(screen.getAllByText('lap 5').length).toBeGreaterThan(0);
    expect(el('[data-chart="time"]')).toBeInTheDocument();
    expect(maybeEl('[data-chart="side"]')).not.toBeInTheDocument();
    expect(screen.queryByText(/^Cursor at/)).not.toBeInTheDocument();
    expect(screen.queryByText('Drive again')).not.toBeInTheDocument();
    expect(screen.queryByText('Use this attempt as a reference')).not.toBeInTheDocument();
    expect(screen.queryByText('Delete attempt')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Corners' })).not.toBeInTheDocument();
    expect(el('.map-switch')).toBeInTheDocument();
  });

  it('shows_the_values_in_a_box_on_the_chart_under_the_pointer_only', async () => {
    await openCompare('?lap=2&with=5');
    await findEl('section.map-panel');
    const plot = (id: string) => el(`[data-chart="${id}"]`);
    const box = () => document.querySelectorAll('.chart-box');
    const rows = () => [...document.querySelectorAll('.chart-box li')].map(row => row.textContent);
    expect(box()).toHaveLength(0);
    fireEvent.pointerEnter(plot('speed'));
    expect(box()).toHaveLength(1);
    expect(plot('speed').querySelector('.chart-box')).not.toBeNull();
    expect(document.querySelector('.chart-box-title')!.textContent).toBe('0 m');
    expect(rows()).toHaveLength(2);
    expect(rows()[0]).toMatch(/^Lap 2: \d+ km\/h$/);
    expect(rows()[1]).toMatch(/^Lap 5: \d+ km\/h$/);
    for (const name of ['throttle', 'brake', 'time']) {
      expect(plot(name).querySelector('.chart-cursor'), name).not.toBeNull();
      expect(plot(name).querySelectorAll('.chart-dot').length, name).toBeGreaterThan(0);
    }
    fireEvent.pointerLeave(plot('speed'));
    fireEvent.pointerEnter(plot('throttle'));
    expect(plot('throttle').querySelector('.chart-box')).not.toBeNull();
    expect(rows()[0]).toMatch(/^Lap 2: \d+%$/);
    fireEvent.pointerLeave(plot('throttle'));
    fireEvent.pointerEnter(plot('time'));
    expect(box()).toHaveLength(0);
  });

  it('shows_the_box_on_a_phone_too', async () => {
    setViewportWidth(390);
    await openCompare();
    await findEl('section.map-panel');
    fireEvent.pointerEnter(el('[data-chart="brake"]'));
    expect([...document.querySelectorAll('.chart-box li')].map(row => row.textContent?.replace(/\d+%$/, 'N'))).toEqual(['Lap 2: N', 'Lap 5: N']);
  });

  it('scrolls_the_differences_inside_their_column_on_a_wide_screen', async () => {
    await openCompare();
    const list = await findSection('Differences by turn');
    expect(list.closest('.race-compare-list')).not.toBeNull();
    expect(list.querySelector('.turn-groups')).toHaveClass('scrolls');
    expect(list.querySelector('.turn-groups')!.contains(els('.turn-group', list)[0]!)).toBe(true);
    expect(list.querySelector('.turn-groups')!.contains(within(list).getByRole('heading', { level: 2 }))).toBe(false);
  });

  it('keeps_the_differences_in_the_page_flow_on_a_phone', async () => {
    setViewportWidth(390);
    await openCompare();
    const list = await findSection('Differences by turn');
    expect(list.closest('.race-compare-list')).toBeNull();
    expect(list.querySelector('.turn-groups')).not.toHaveClass('scrolls');
  });

  it('scrolls_the_list_and_not_the_page_to_a_selected_difference', async () => {
    const scrollTo = vi.spyOn(window, 'scrollTo');
    const intoView = vi.fn();
    Element.prototype.scrollIntoView = intoView;
    await openCompare();
    const list = await findSection('Differences by turn');
    const groups = list.querySelector('.turn-groups') as HTMLElement;
    const item = within(list).getAllByRole('button', { name: /^\d+ m / })[1]!;
    Object.defineProperty(groups, 'getBoundingClientRect', { value: () => ({ top: 100, bottom: 300, left: 0, right: 300, width: 300, height: 200 }) });
    Object.defineProperty(item, 'getBoundingClientRect', { value: () => ({ top: 400, bottom: 440, left: 0, right: 300, width: 300, height: 40 }) });
    groups.scrollTop = 0;
    await userEvent.setup().click(item);
    expect(groups.scrollTop).toBe(140);
    expect(scrollTo).not.toHaveBeenCalled();
    expect(intoView).not.toHaveBeenCalled();
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  });

  it('keeps_the_turn_labels_of_the_speed_chart_apart', async () => {
    const corner = (number: number, fromSM: number, toSM: number) => ({ number, turnInSM: fromSM, apexSM: fromSM, radiusM: 40, apexSpeedMps: 25, zoneFromSM: fromSM, zoneToSM: toSM, outsideM: null, speedMps: 24 });
    await openCompare('?lap=5&with=2', ringDetail(), () => raceCompare({ lap: 5, withLap: 2, corners: [corner(9, 9, 9.2), corner(10, 9.2, 9.4), corner(11, 9.4, 9.6)] }));
    await findEl('section.map-panel');
    const labels = els('[data-chart="speed"] .turn-label');
    expect(labels.map(label => label.textContent)).toEqual(['T9', 'T10']);
    expect(labels.map(label => label.style.top)).toEqual(['4px', '18px']);
  });

  it('holds_each_chart_in_a_field_with_its_name_unit_and_readout', async () => {
    await openCompare();
    await findEl('section.map-panel');
    const fields = [
      ['speed', 'Speed', 'km/h'],
      ['throttle', 'Throttle', null],
      ['brake', 'Brake', null],
      ['time', 'Time lost to lap 2', 's']
    ] as const;
    for (const [name, title, unit] of fields) {
      const field = el(`[data-chart="${name}"]`).closest('.chart-field')!;
      expect(field.querySelector('.field-title')!.textContent, name).toBe(title);
      expect(field.querySelector('.field-unit')?.textContent ?? null, name).toBe(unit);
      expect(field.querySelector('.channel-readout') === null, name).toBe(name !== 'time');
    }
    expect(el('[data-chart="time"]').closest('.chart-field')!.querySelector('.channel-readout')!.textContent).toMatch(/^[+-]?\d\.\d\d s$/);
    const throttleTicks = [...el('[data-chart="throttle"]').closest('.chart-field')!.querySelectorAll('.y-axis span')].map(span => span.textContent);
    expect(throttleTicks).toEqual(['0%', '50%', '100%']);
    const legend = document.querySelector('.side-legend')!;
    expect(legend.closest('.chart-field')).toBeNull();
    expect(legend.nextElementSibling).toHaveClass('chart-field');
    expect(legend.closest('.channel')!.querySelector('[data-chart="time"]')).not.toBeNull();
  });

  it('compare_intro_keeps_only_the_note_on_the_other_lap', async () => {
    await openCompare();
    const list = await findSection('Differences by turn');
    expect(within(list).getByText('Lap 2 is one of your laps, not the best possible line.')).toBeInTheDocument();
    expect(screen.queryByText(/Turns in the order|Time lost is measured|Move the pointer or a finger/)).toBeNull();
  });

  it('groups_the_differences_by_turn_with_no_difference_and_an_even_turn', async () => {
    await openCompare();
    const list = await findSection('Differences by turn');
    const groups = els('.turn-group', list);
    expect(groups.map(turnGroupName)).toEqual(['T1 · 0.40 s lost', 'T2 · 0.00 s', 'T3 · 0.46 s gained']);
    expect(groups[0]).toHaveTextContent('Braked 70 m earlier');
    expect(groups[0]).toHaveTextContent('16 km/h slower in the corner');
    expect(groups[1]).toHaveTextContent('No difference');
    expect(groups[1]!.querySelector('.turn-even')).not.toBeNull();
    expect(within(list).queryByRole('radio', { name: 'Time lost' })).not.toBeInTheDocument();
  });

  it('selects_change_the_address_and_load_again', async () => {
    const api = await openCompare();
    const lap = (await findEls('.race-compare-selects select'))[0]!;
    const withLap = els('.race-compare-selects select')[1]!;
    expect([...lap.querySelectorAll('option')].map(option => option.textContent)).toEqual(['Lap 1 · 1:23.585', 'Lap 3 · 1:18.765', 'Lap 4 · 1:19.208', 'Lap 5 · 1:19.336']);
    expect([...withLap.querySelectorAll('option')].map(option => option.textContent)).toEqual(['Lap 1 · 1:23.585', 'Lap 2 · 1:17.623', 'Lap 3 · 1:18.765', 'Lap 4 · 1:19.208']);
    await userEvent.selectOptions(lap, 'Lap 4 · 1:19.208');
    await waitFor(() => expect(window.location.search).toBe('?lap=4&with=2'));
    await waitFor(() => expect(compareCalls(api)).toHaveLength(2));
    expect(await screen.findByRole('heading', { level: 2, name: 'Lap 4 is 1.585 s slower than lap 2' })).toBeInTheDocument();
    await userEvent.selectOptions(els('.race-compare-selects select')[1]!, 'Lap 3 · 1:18.765');
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
    expect((await findEls('.race-compare-selects select'))[1]!).toHaveValue('2');
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
    await openCompare('?lap=5&with=2', ringDetail(), () => ({ status: 409, body: { code } }));
    expect(await screen.findByText(text)).toBeInTheDocument();
    expect((await findEls('.race-compare-selects select'))[0]!).toBeInTheDocument();
    expect(els('.race-compare-selects select')[1]!).toBeInTheDocument();
    expect(screen.queryByRole('slider')).not.toBeInTheDocument();
  });

  it('explains_the_pit_lane_gap_and_keeps_the_option_text_short', async () => {
    const detail = ringDetail();
    const laps = detail.laps.map(lap => (lap.number === 3 ? { ...lap, pitOut: true, closed: false } : lap));
    await openCompare('?lap=3&with=2', { ...detail, laps }, () => raceCompare({ lap: 3, withLap: 2 }));
    (await findEls('.race-compare-selects select'))[0]!;
    expect([...els('.race-compare-selects select')[1]!.querySelectorAll('option')].map(option => option.textContent)).toContain('Lap 2 · 1:17.623');
    expect([...els('.race-compare-selects select')[0]!.querySelectorAll('option')].map(option => option.textContent)).toContain('Lap 3 · 1:18.765');
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
    await findEl('section.map-panel');
    expect(screen.queryByText('A gap in the line is the pit lane.')).not.toBeInTheDocument();
    expect(screen.queryByText(/pit lane\. The curve|The rest of the gap/)).not.toBeInTheDocument();
  });

  it('phone_shows_head_selects_map_differences_charts_and_no_scale_switch', async () => {
    setViewportWidth(390);
    await openCompare();
    const map = await findEl('section.map-panel');
    const select = (await findEls('.race-compare-selects select'))[0]!;
    const differences = sectionOf('Differences by turn');
    const speed = el('[data-chart="speed"]');
    expect(select.compareDocumentPosition(map) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(map.compareDocumentPosition(differences) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(differences.compareDocumentPosition(speed) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(maybeEl('.map-switch')).not.toBeInTheDocument();
  });

  it('names_the_line_of_the_other_lap_in_an_off_line_difference', async () => {
    await openCompare('?lap=5&with=2', ringDetail(), () => raceCompare({ findings: [{ kind: 'off-line', eventKey: null, sM: 16, size: 4.2, unit: 'm', turn: 2 }] }));
    const list = await findSection('Differences by turn');
    expect(list).toHaveTextContent('Up to 4 m from the line of lap 2');
    expect(list).not.toHaveTextContent('reference line');
  });

  it('names_the_lap_in_the_map_view', async () => {
    await openCompare();
    await userEvent.click(await screen.findByRole('button', { name: 'View' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Line of lap 2, 20 m.');
    expect(el('.track-map', dialog)).toBeInTheDocument();
  });

  it('writes_every_length_in_the_map_view_with_a_thousands_separator', async () => {
    await openCompare('?lap=5&with=2', ringDetail(), () => raceCompare({ lengthM: 6181, findings: [{ kind: 'off-line', eventKey: null, sM: 1234, size: 4.2, unit: 'm', turn: 2 }] }));
    await userEvent.click(await screen.findByRole('button', { name: 'View' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Line of lap 2, 6,181 m.');
    expect(within(dialog).getByText('1,234 m')).toBeInTheDocument();
  });

  it('marks_the_lap_line_on_the_map_and_in_the_map_view', async () => {
    await openCompare();
    const panel = await findEl('section.map-panel');
    expect([...panel.querySelectorAll('.track-label')].map(node => node.textContent)).toEqual(['lap line']);
    expect(panel.querySelector('.track-finish')).toBeNull();
    await userEvent.click(within(panel).getByRole('button', { name: 'View' }));
    expect([...screen.getByRole('dialog').querySelectorAll('.track-label')].map(node => node.textContent)).toEqual(['lap line']);
  });

  it('keeps_start_and_finish_when_the_other_lap_has_a_pit_stop', async () => {
    const detail = ringDetail();
    const laps = detail.laps.map(lap => (lap.number === 3 ? { ...lap, pitOut: true, closed: false } : lap));
    await openCompare('?lap=5&with=3', { ...detail, laps }, () => raceCompare({ lap: 5, withLap: 3 }));
    const panel = await findEl('section.map-panel');
    expect([...panel.querySelectorAll('.track-label')].map(node => node.textContent)).toEqual(['start', 'finish']);
  });

  it('keeps_start_and_finish_when_the_server_says_that_the_other_lap_is_not_closed', async () => {
    const detail = ringDetail();
    const laps = detail.laps.map(lap => (lap.number === 2 ? { ...lap, closed: false } : lap));
    await openCompare('?lap=5&with=2', { ...detail, laps }, () => raceCompare({ lap: 5, withLap: 2 }));
    const panel = await findEl('section.map-panel');
    expect([...panel.querySelectorAll('.track-label')].map(node => node.textContent)).toEqual(['start', 'finish']);
  });

  it('keeps_start_and_finish_when_the_other_lap_is_lap_1', async () => {
    await openCompare('?lap=5&with=1', undefined, () => raceCompare({ lap: 5, withLap: 1 }));
    const panel = await findEl('section.map-panel');
    expect([...panel.querySelectorAll('.track-label')].map(node => node.textContent)).toEqual(['start', 'finish']);
  });

  it('calls_a_difference_outside_the_turns_whole_lap', async () => {
    await openCompare('?lap=5&with=2', ringDetail(), () => raceCompare({ findings: [{ kind: 'brake-late', eventKey: 'brake@3', sM: 3, size: 12, unit: 'm', turn: null }], turnLosses: [] }));
    const list = await findSection('Differences by turn');
    expect(els('.turn-group', list).map(turnGroupName)).toEqual(['Whole lap']);
  });

  it('moves_the_cursor_to_a_selected_difference', async () => {
    await openCompare();
    const list = await findSection('Differences by turn');
    await userEvent.click(within(list).getByRole('button', { name: /Braked 70 m earlier/ }));
    expect(el('[data-chart="speed"]')).toHaveAttribute('aria-valuenow', '10');
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

