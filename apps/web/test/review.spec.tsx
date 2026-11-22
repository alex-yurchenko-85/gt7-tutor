import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { KPH_PER_MPS } from '@gt7/contracts';
import { exercise, exerciseApi, reference, EXERCISE_ID } from './fixtures.ts';
import { attemptSummary, review, withGap, ATTEMPT_ID, REVIEW_PATH } from './review-fixtures.ts';
import * as chartSegments from '../src/charts/geometry.ts';
import { renderApp, setViewportWidth, USER, type ApiStub } from './support.tsx';

vi.mock('../src/charts/geometry.ts', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/charts/geometry.ts')>();
  return { ...actual, lineSegments: vi.fn(actual.lineSegments), seriesSegments: vi.fn(actual.seriesSegments) };
});

const requestedReferences: (string | null)[] = [];

function reviewApi(data = review(), attempt = attemptSummary(), current = exercise()): ApiStub {
  requestedReferences.length = 0;
  return exerciseApi(current)
    .on(`GET /api/attempts/${ATTEMPT_ID}`, attempt)
    .on(`GET /api/attempts/${ATTEMPT_ID}/review`, (_body: unknown, url: URL) => {
      requestedReferences.push(url.searchParams.get('referenceId'));
      return url.searchParams.get('referenceId') === 'ref-attempt' ? review({ referenceId: 'ref-attempt', findings: [] }) : data;
    })
    .on(`GET /api/exercises/${EXERCISE_ID}/references`, [
      reference(),
      reference({ id: 'ref-attempt', origin: 'attempt', active: false, createdAt: '2026-11-17T10:00:00.000Z' })
    ])
    .install();
}

function cursorX(): string | null {
  return document.querySelector('[data-chart="speed"] .chart-cursor')?.getAttribute('x1') ?? null;
}

function mapCursor(): string | null {
  return document.querySelector('.track-cursor')?.getAttribute('cx') ?? null;
}

function sideReview() {
  const base = review({
    corners: [
      { number: 1, turnInSM: 0, apexSM: 4, radiusM: 40, apexSpeedMps: 25, zoneFromSM: 0, zoneToSM: 8, outsideM: 5, speedMps: 24 },
      { number: 2, turnInSM: 10, apexSM: 14, radiusM: 40, apexSpeedMps: 25, zoneFromSM: 10, zoneToSM: 16, outsideM: 1.2, speedMps: 24 }
    ]
  });
  const lat = [1, 1, -2.5, -5, 1, 1, 1, 1.2, 0.4, 0, 0];
  return { ...base, attempt: { ...base.attempt, lat, z: lat } };
}

function referenceY(): number {
  return Number(document.querySelector('.track-map .track-reference')!.getAttribute('points')!.split(' ')[0]!.split(',')[1]);
}

function attemptYs(): number[] {
  return document
    .querySelector('.track-map [data-segment="attempt"]')!
    .getAttribute('points')!
    .split(' ')
    .map(point => Number(point.split(',')[1]));
}

describe('attempt review', () => {
  it('review_links_cursor_between_charts_and_map', async () => {
    reviewApi();
    renderApp({ path: REVIEW_PATH });
    const speed = await screen.findByRole('slider', { name: 'Speed, km/h' });
    expect(document.querySelector('.chart-field')).toBeNull();
    expect(screen.getByText('Speed, km/h')).not.toHaveClass('visually-hidden');
    const before = { chart: cursorX(), map: mapCursor() };
    speed.focus();
    await userEvent.setup().keyboard('{ArrowRight}{ArrowRight}');
    expect(screen.getByText('Cursor at 4 m', { exact: false })).toBeInTheDocument();
    expect(cursorX()).not.toBe(before.chart);
    expect(mapCursor()).not.toBe(before.map);
    const brake = screen.getByRole('slider', { name: 'Brake' });
    Object.defineProperty(brake, 'getBoundingClientRect', { value: () => ({ left: 0, width: 200, top: 0, height: 50, right: 200, bottom: 50 }) });
    fireEvent.pointerDown(brake, { clientX: 100 });
    expect(screen.getByText('Cursor at 10 m', { exact: false })).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'Speed, km/h' })).toHaveAttribute('aria-valuenow', '10');
  });

  it('review_pointer_move_renders_only_the_cursor', async () => {
    reviewApi();
    renderApp({ path: REVIEW_PATH });
    const speed = await screen.findByRole('slider', { name: 'Speed, km/h' });
    Object.defineProperty(speed, 'getBoundingClientRect', { value: () => ({ left: 0, width: 200, top: 0, height: 50, right: 200, bottom: 50 }) });
    const chartCalls = vi.mocked(chartSegments.seriesSegments).mock.calls.length;
    const mapCalls = vi.mocked(chartSegments.lineSegments).mock.calls.length;
    const polyline = document.querySelector('[data-chart="speed"] [data-series="you"]');
    const before = cursorX();
    fireEvent.pointerMove(speed, { clientX: 100, buttons: 1 });
    await waitFor(() => expect(cursorX()).not.toBe(before));
    expect(vi.mocked(chartSegments.seriesSegments).mock.calls.length).toBe(chartCalls);
    expect(vi.mocked(chartSegments.lineSegments).mock.calls.length).toBe(mapCalls);
    expect(document.querySelector('[data-chart="speed"] [data-series="you"]')).toBe(polyline);
    expect(speed).toHaveAttribute('aria-valuenow', '10');
  });

  it('review_cancels_a_pending_cursor_frame_on_unmount', async () => {
    reviewApi();
    const view = renderApp({ path: REVIEW_PATH });
    const speed = await screen.findByRole('slider', { name: 'Speed, km/h' });
    Object.defineProperty(speed, 'getBoundingClientRect', { value: () => ({ left: 0, width: 200, top: 0, height: 50, right: 200, bottom: 50 }) });
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback));
    const cancel = vi.fn();
    vi.stubGlobal('cancelAnimationFrame', cancel);
    fireEvent.pointerMove(speed, { clientX: 100, buttons: 1 });
    expect(frames).toHaveLength(1);
    view.unmount();
    expect(cancel).toHaveBeenCalledWith(1);
  });

  it('selecting_a_difference_moves_the_cursor', async () => {
    reviewApi();
    renderApp({ path: REVIEW_PATH });
    const list = await screen.findByRole('region', { name: 'Differences by turn' });
    const off = within(list).getByRole('button', { name: /16 m\. Up to 2 m from the reference line/ });
    await userEvent.setup().click(off);
    expect(off).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('slider', { name: 'Speed, km/h' })).toHaveAttribute('aria-valuenow', '16');
  });

  it('unmatched_gap_breaks_the_line', async () => {
    reviewApi(withGap(review()));
    renderApp({ path: REVIEW_PATH });
    await screen.findByRole('slider', { name: 'Speed, km/h' });
    expect(document.querySelectorAll('.track-map [data-segment="attempt"]')).toHaveLength(2);
    expect(document.querySelectorAll('[data-chart="speed"] [data-series="you"]')).toHaveLength(2);
    expect(document.querySelectorAll('[data-chart="speed"] [data-series="ref"]')).toHaveLength(1);
  });

  it('review_can_switch_reference', async () => {
    reviewApi();
    renderApp({ path: REVIEW_PATH });
    const select = await screen.findByRole('combobox', { name: 'Compare with' });
    await screen.findByRole('option', { name: /Your attempt/ });
    expect(within(select).getAllByRole('option').filter(option => option.textContent?.endsWith('(used for this attempt)'))).toHaveLength(1);
    expect(requestedReferences).toEqual([null]);
    await userEvent.setup().selectOptions(select, 'ref-attempt');
    await waitFor(() => expect(requestedReferences).toEqual([null, 'ref-attempt']));
    expect(window.location.search).toBe('?reference=ref-attempt');
    expect(await screen.findByText(/No differences above the limits/)).toBeInTheDocument();
  });

  it('differences_heading_explains_the_reference', async () => {
    reviewApi();
    renderApp({ path: REVIEW_PATH });
    expect(await screen.findByRole('heading', { name: 'Differences by turn' })).toBeInTheDocument();
    expect(screen.getByText(/The reference is one recorded drive, not the best possible line/)).toBeInTheDocument();
    expect(screen.queryByText(/mistake/)).toBeNull();
  });

  it('review_keyboard_help_is_a_description_of_the_charts_and_no_hint_texts_show', async () => {
    reviewApi();
    renderApp({ path: REVIEW_PATH });
    const list = await screen.findByRole('region', { name: 'Differences by turn' });
    expect(within(list).getByText('The reference is one recorded drive, not the best possible line.')).toBeInTheDocument();
    expect(document.querySelector('.charts')).not.toHaveAttribute('aria-describedby');
    for (const slider of document.querySelectorAll('.charts [role="slider"]')) expect(slider).toHaveAccessibleDescription('Focus a chart and use the arrow keys to move the cursor. The map point shows the same place.');
    expect(screen.queryByText(/Move the pointer or a finger/)).toBeNull();
    expect(screen.queryByText(/Turns in the order|Time lost is measured|Select a difference/)).toBeNull();
  });

  it('phone_review_shows_map_and_differences_first', async () => {
    setViewportWidth(390);
    reviewApi();
    renderApp({ path: REVIEW_PATH });
    const heading = await screen.findByRole('heading', { name: 'Differences by turn' });
    const map = document.querySelector('.track-map')!;
    const speed = screen.getByRole('slider', { name: 'Speed, km/h' });
    expect(map.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(heading.compareDocumentPosition(speed) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('review_lists_corners_inside_or_outside', async () => {
    const corners = [
      { number: 1, turnInSM: 461, apexSM: 519, radiusM: 43, apexSpeedMps: 89 / KPH_PER_MPS, zoneFromSM: 461, zoneToSM: 577, outsideM: 4.84, speedMps: 84.2 / KPH_PER_MPS },
      { number: 2, turnInSM: 691, apexSM: 737, radiusM: 66, apexSpeedMps: 110 / KPH_PER_MPS, zoneFromSM: 691, zoneToSM: 783, outsideM: 0.4, speedMps: 111 / KPH_PER_MPS },
      { number: 3, turnInSM: 834, apexSM: 870, radiusM: 84, apexSpeedMps: 123 / KPH_PER_MPS, zoneFromSM: 834, zoneToSM: 900, outsideM: -1.26, speedMps: null },
      { number: 4, turnInSM: 900, apexSM: 950, radiusM: 84, apexSpeedMps: 123 / KPH_PER_MPS, zoneFromSM: 900, zoneToSM: 1000, outsideM: null, speedMps: null }
    ];
    reviewApi(review({ corners }));
    renderApp({ path: REVIEW_PATH });
    const list = await screen.findByRole('region', { name: 'Corners' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('Turn 1');
    expect(rows[0]).toHaveTextContent('4.8 m outside');
    expect(rows[0]).toHaveTextContent('84 km/h at the apex, reference 89 km/h');
    expect(rows[1]).toHaveTextContent('on the line');
    expect(rows[2]).toHaveTextContent('1.3 m inside');
    expect(rows[2]).toHaveTextContent('no speed match at the apex');
    expect(rows[3]).toHaveTextContent('no match at the apex');
  });

  it('review_shows_the_same_corner_speed_after_the_unit_change', async () => {
    const corners = [{ number: 1, turnInSM: 2, apexSM: 4, radiusM: 43, apexSpeedMps: 88.6 / KPH_PER_MPS, zoneFromSM: 2, zoneToSM: 6, outsideM: 0, speedMps: 84.2 / KPH_PER_MPS }];
    const findings = [{ kind: 'slow-corner' as const, eventKey: 'brake@4', sM: 4, size: 15.6 / KPH_PER_MPS, unit: 'm/s' as const, turn: 1 }];
    reviewApi(review({ corners, findings }));
    renderApp({ path: REVIEW_PATH });
    const list = await screen.findByRole('region', { name: 'Corners' });
    expect(within(list).getAllByRole('listitem')[0]).toHaveTextContent('84 km/h at the apex, reference 89 km/h');
    const differences = screen.getByRole('region', { name: 'Differences by turn' });
    expect(within(differences).getByRole('button', { name: /16 km\/h slower in the corner/ })).toBeInTheDocument();
  });

  it('review_shows_brake_reaction_of_the_attempt', async () => {
    reviewApi(review({ reactions: [{ eventKey: 'brake@10', reactionMs: 640 }] }));
    renderApp({ path: REVIEW_PATH });
    const list = await screen.findByRole('region', { name: 'Brake reaction' });
    expect(list).toHaveTextContent('10 m: you started to brake 0.6 s after the cue');
  });

  it('review_without_corners_shows_whole_section_group', async () => {
    reviewApi();
    renderApp({ path: REVIEW_PATH });
    const list = await screen.findByRole('region', { name: 'Differences by turn' });
    const groups = within(list).getAllByRole('group').filter(group => group.getAttribute('aria-label') !== null);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveAccessibleName('Whole section');
    expect(within(groups[0]!).getAllByRole('button')).toHaveLength(2);
    expect(document.querySelectorAll('[data-band]')).toHaveLength(0);
  });

  it('review_groups_follow_the_track_and_sort_by_time_lost', async () => {
    reviewApi(
      review({
        findings: [
          { kind: 'brake-early', eventKey: 'brake@4', sM: 4, size: 2, unit: 'm', turn: 1 },
          { kind: 'off-line', eventKey: null, sM: 12, size: 1.6, unit: 'm', turn: 2 },
          { kind: 'throttle-late', eventKey: 'throttle@16', sM: 16, size: 3, unit: 'm', turn: 2 }
        ],
        turnLosses: [
          { turn: 1, fromSM: 0, toSM: 10, lostMs: -120 },
          { turn: 2, fromSM: 10, toSM: 20, lostMs: 500 }
        ]
      })
    );
    renderApp({ path: REVIEW_PATH });
    const list = await screen.findByRole('region', { name: 'Differences by turn' });
    const order = within(list).getByRole('group', { name: 'Order of the turns' });
    expect(within(order).getByRole('radio', { name: 'Track' })).toBeChecked();
    const turnGroups = () => within(list).getAllByRole('group').filter(group => group !== order);
    expect(turnGroups().map(group => group.getAttribute('aria-label'))).toEqual(['T1 · 0.12 s gained', 'T2 · 0.50 s lost']);
    const user = userEvent.setup();
    await user.click(within(order).getByRole('radio', { name: 'Time lost' }));
    expect(turnGroups().map(group => group.getAttribute('aria-label'))).toEqual(['T2 · 0.50 s lost', 'T1 · 0.12 s gained']);
    const groups = turnGroups();
    expect(within(groups[0]!).getAllByRole('button')).toHaveLength(2);
    await user.click(within(groups[1]!).getByRole('button', { name: /4 m\. Braked 2 m earlier/ }));
    expect(screen.getByRole('slider', { name: 'Speed, km/h' })).toHaveAttribute('aria-valuenow', '4');
    expect(document.querySelectorAll('[data-chart="speed"] [data-band]')).toHaveLength(0);
  });

  it('difference_header_shows_the_turn_and_the_time_lost', async () => {
    reviewApi(
      review({
        findings: [{ kind: 'brake-late', eventKey: 'brake@4', sM: 4, size: 6, unit: 'm', turn: 1 }],
        turnLosses: [{ turn: 1, fromSM: 346, toSM: 462, lostMs: 300 }]
      })
    );
    renderApp({ path: REVIEW_PATH });
    const list = await screen.findByRole('region', { name: 'Differences by turn' });
    expect(within(list).getByRole('group', { name: 'T1 · 0.30 s lost' })).toBeInTheDocument();
  });

  it('difference_header_has_only_the_turn_when_no_time_is_lost', async () => {
    reviewApi(
      review({
        findings: [{ kind: 'brake-late', eventKey: 'brake@4', sM: 4, size: 6, unit: 'm', turn: 1 }],
        turnLosses: [{ turn: 1, fromSM: 346, toSM: 462, lostMs: null }]
      })
    );
    renderApp({ path: REVIEW_PATH });
    const list = await screen.findByRole('region', { name: 'Differences by turn' });
    expect(within(list).getByRole('group', { name: 'T1' })).toBeInTheDocument();
    expect(list).not.toHaveTextContent(/346|462/);
  });

  it('charts_shade_the_turn_zone_of_each_corner', async () => {
    const corners = [
      { number: 1, turnInSM: 2, apexSM: 4, radiusM: 40, apexSpeedMps: 90 / KPH_PER_MPS, zoneFromSM: 2, zoneToSM: 6, outsideM: 0, speedMps: 88 / KPH_PER_MPS },
      { number: 2, turnInSM: 12, apexSM: 16, radiusM: 40, apexSpeedMps: 90 / KPH_PER_MPS, zoneFromSM: 12, zoneToSM: 18, outsideM: 0, speedMps: 88 / KPH_PER_MPS }
    ];
    reviewApi(review({ corners }));
    renderApp({ path: REVIEW_PATH });
    await screen.findByRole('slider', { name: 'Speed, km/h' });
    const bands = [...document.querySelectorAll('[data-chart="speed"] [data-band]')];
    expect(bands.map(band => [band.getAttribute('data-band'), band.getAttribute('x'), band.getAttribute('width')])).toEqual([
      ['T1', '80.0', '160.0'],
      ['T2', '480.0', '240.0']
    ]);
    expect(document.querySelectorAll('.track-map .track-turn')).toHaveLength(2);
    expect([...document.querySelectorAll('.track-map .track-turn-label')].map(label => label.textContent)).toEqual(['T1', 'T2']);
  });

  it('empty_turn_zone_has_no_band_and_no_label', async () => {
    const corners = [
      { number: 1, turnInSM: 2, apexSM: 4, radiusM: 40, apexSpeedMps: 90 / KPH_PER_MPS, zoneFromSM: 2, zoneToSM: 6, outsideM: 0, speedMps: 88 / KPH_PER_MPS },
      { number: 2, turnInSM: 12, apexSM: 16, radiusM: 40, apexSpeedMps: 90 / KPH_PER_MPS, zoneFromSM: 12, zoneToSM: 12, outsideM: 0, speedMps: 88 / KPH_PER_MPS },
      { number: 3, turnInSM: 14, apexSM: 16, radiusM: 40, apexSpeedMps: 90 / KPH_PER_MPS, zoneFromSM: 14, zoneToSM: 13, outsideM: 0, speedMps: 88 / KPH_PER_MPS }
    ];
    reviewApi(review({ corners }));
    renderApp({ path: REVIEW_PATH });
    await screen.findByRole('slider', { name: 'Speed, km/h' });
    expect([...document.querySelectorAll('[data-chart="speed"] [data-band]')].map(band => band.getAttribute('data-band'))).toEqual(['T1']);
    expect([...document.querySelectorAll('[data-chart="speed"] .turn-label')].map(label => label.textContent)).toEqual(['T1']);
  });

  it('two_bands_two_labels', async () => {
    const corners = [
      { number: 1, turnInSM: 2, apexSM: 4, radiusM: 40, apexSpeedMps: 90 / KPH_PER_MPS, zoneFromSM: 2, zoneToSM: 6, outsideM: 0, speedMps: 88 / KPH_PER_MPS },
      { number: 2, turnInSM: 12, apexSM: 16, radiusM: 40, apexSpeedMps: 90 / KPH_PER_MPS, zoneFromSM: 12, zoneToSM: 18, outsideM: 0, speedMps: 88 / KPH_PER_MPS }
    ];
    reviewApi(review({ corners }));
    renderApp({ path: REVIEW_PATH });
    await screen.findByRole('slider', { name: 'Speed, km/h' });
    const labels = [...document.querySelectorAll('[data-chart="speed"] .turn-label')];
    expect(labels.map(label => [label.textContent, (label as HTMLElement).style.left])).toEqual([
      ['T1', '20%'],
      ['T2', '75%']
    ]);
    expect(document.querySelectorAll('.distance-axis b')).toHaveLength(0);
    expect(document.querySelectorAll('.turn-label')).toHaveLength(2);
  });

  it('charts_share_scales_and_the_side_chart_is_taller', async () => {
    reviewApi();
    renderApp({ path: REVIEW_PATH });
    await screen.findByRole('slider', { name: 'Speed, km/h' });
    const charts = [...document.querySelectorAll('.channel')];
    expect(charts).toHaveLength(5);
    expect(charts.map(chart => chart.querySelector('svg')!.style.height)).toEqual(['120px', '120px', '120px', '180px', '120px']);
    const labels = (chart: Element, selector: string) => [...chart.querySelectorAll(selector)].map(item => item.textContent);
    expect(labels(charts[0]!, '.y-axis span')).toEqual(['100', '120', '140']);
    expect(labels(charts[1]!, '.y-axis span')).toEqual(['0%', '50%', '100%']);
    expect(labels(charts[2]!, '.y-axis span')).toEqual(['0%', '50%', '100%']);
    expect(labels(charts[4]!, '.y-axis span')).toContain('0');
    expect(labels(charts[4]!, '.y-axis span').some(label => label?.startsWith('+'))).toBe(true);
    charts.forEach(chart => expect(labels(chart, '.distance-axis span')).toEqual(['0 m', '5', '10', '15']));
    expect(charts[0]!.querySelectorAll('.chart-grid')).toHaveLength(3);
  });

  it('side_distance_chart_follows_brake_and_shares_the_cursor', async () => {
    reviewApi();
    renderApp({ path: REVIEW_PATH });
    await screen.findByRole('slider', { name: 'Speed, km/h' });
    const names = screen.getAllByRole('slider').map(slider => slider.getAttribute('data-chart'));
    expect(names).toEqual(['speed', 'throttle', 'brake', 'side', 'time']);
    const side = screen.getByRole('slider', { name: 'Distance from the reference line, m' });
    Object.defineProperty(side, 'getBoundingClientRect', { value: () => ({ left: 0, width: 200, top: 0, height: 50, right: 200, bottom: 50 }) });
    fireEvent.pointerDown(side, { clientX: 100 });
    expect(screen.getByText('Cursor at 10 m', { exact: false })).toBeInTheDocument();
    names.forEach(name => expect(document.querySelector(`[data-chart="${name}"]`)).toHaveAttribute('aria-valuenow', '10'));
  });

  it('charts_are_titled_in_the_designed_order', async () => {
    reviewApi();
    renderApp({ path: REVIEW_PATH });
    await screen.findByRole('slider', { name: 'Speed, km/h' });
    const titles = [...document.querySelectorAll('.channel .channel-label span:first-child')].map(item => item.textContent);
    expect(titles).toEqual(['Speed, km/h', 'Throttle', 'Brake', 'Distance from the reference line, m', 'Time lost to the reference, s']);
  });

  it('side_distance_axis_uses_words_and_unsigned_numbers', async () => {
    reviewApi();
    renderApp({ path: REVIEW_PATH });
    await screen.findByRole('slider', { name: 'Distance from the reference line, m' });
    const labels = [...document.querySelectorAll('[data-chart="side"]')[0]!.closest('.channel')!.querySelectorAll('.y-axis span')].map(item => item.textContent);
    expect(labels[0]).toBe('right');
    expect(labels.at(-1)).toBe('left');
    expect(labels).toContain('line');
    expect(labels.filter(label => label !== 'right' && label !== 'left' && label !== 'line').every(label => /^\d+(\.\d+)?$/.test(label!))).toBe(true);
  });

  it('side_distance_chart_draws_you_against_the_reference_line', async () => {
    reviewApi();
    renderApp({ path: REVIEW_PATH });
    await screen.findByRole('slider', { name: 'Distance from the reference line, m' });
    const plot = document.querySelector('[data-chart="side"]')!;
    expect(plot.querySelectorAll('[data-series="ref"]')).toHaveLength(1);
    expect(plot.querySelectorAll('[data-series="you"]')).toHaveLength(1);
    expect(plot.querySelectorAll('[data-series="ink"]')).toHaveLength(0);
    expect(plot.querySelectorAll('.chart-area')).toHaveLength(1);
  });

  it('side_distance_legend_names_the_cue_distance', async () => {
    reviewApi();
    renderApp({ path: REVIEW_PATH });
    await screen.findByRole('slider', { name: 'Distance from the reference line, m' });
    const legend = document.querySelector('.side-legend')!;
    expect(legend).toHaveTextContent('reference line');
    expect(legend).toHaveTextContent('you');
    expect(legend).toHaveTextContent('side cue distance, 2 m');
  });

  it('side_distance_legend_has_no_cue_entry_when_off', async () => {
    reviewApi(review(), attemptSummary(), exercise({ sideCueDistanceM: null }));
    renderApp({ path: REVIEW_PATH });
    await screen.findByRole('slider', { name: 'Distance from the reference line, m' });
    const legend = document.querySelector('.side-legend')!;
    expect(legend).toHaveTextContent('reference line');
    expect(legend).not.toHaveTextContent('side cue distance');
  });

  it('side_distance_readout_texts', async () => {
    const base = review();
    const lat = base.attempt.lat.map((_, i) => (i === 0 ? 0 : i === 1 ? 0.4 : i === 2 ? -5 : i === 3 ? 5.04 : i === 4 ? null : 1));
    reviewApi({ ...base, attempt: { ...base.attempt, lat } });
    renderApp({ path: REVIEW_PATH });
    const side = await screen.findByRole('slider', { name: 'Distance from the reference line, m' });
    const channel = side.closest('.channel')!;
    const readout = () => channel.querySelector('.channel-label span:last-child')!.textContent;
    const user = userEvent.setup();
    side.focus();
    expect(readout()).toBe('on the line');
    await user.keyboard('{ArrowRight}');
    expect(readout()).toBe('on the line');
    await user.keyboard('{ArrowRight}');
    expect(readout()).toBe('5.0 m left of the line');
    await user.keyboard('{ArrowRight}');
    expect(readout()).toBe('5.0 m right of the line');
    await user.keyboard('{ArrowRight}');
    expect(readout()).toBe('no match here');
    await user.keyboard('{ArrowRight}');
    expect(readout()).toBe('1.0 m right of the line');
  });

  it('side_distance_chart_marks_the_side_cue_distance', async () => {
    reviewApi();
    renderApp({ path: REVIEW_PATH });
    await screen.findByRole('slider', { name: 'Distance from the reference line, m' });
    await waitFor(() => expect(document.querySelectorAll('[data-chart="side"] .chart-threshold')).toHaveLength(2));
    expect(document.querySelectorAll('[data-chart="speed"] .chart-threshold')).toHaveLength(0);
    const ys = [...document.querySelectorAll('[data-chart="side"] .chart-threshold')].map(line => Number(line.getAttribute('y1')));
    const zero = Number(document.querySelector('[data-chart="side"] .chart-zero')!.getAttribute('y1'));
    expect(ys[0]! + ys[1]!).toBeCloseTo(zero * 2, 5);
  });

  it('off_has_no_threshold_marks', async () => {
    reviewApi(sideReview(), attemptSummary(), exercise({ sideCueDistanceM: null }));
    renderApp({ path: REVIEW_PATH });
    await screen.findByRole('slider', { name: 'Distance from the reference line, m' });
    expect(document.querySelectorAll('.chart-threshold')).toHaveLength(0);
    expect(document.querySelectorAll('[data-chart="side"] [data-series="you"]')).toHaveLength(1);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Side distance × 6' }));
    expect(document.querySelectorAll('.track-map [data-segment="attempt"]')).toHaveLength(1);
    expect(document.querySelectorAll('.track-map .track-far')).toHaveLength(0);
    expect([...document.querySelectorAll('.track-map .track-peak')].map(dot => dot.getAttribute('aria-label'))).toEqual(['T1 5.0 m left, at 6 m', 'T2 1.2 m right, at 14 m']);
    expect(document.querySelector('.map-legend')).not.toHaveTextContent('from the line');
  });

  it('map_switch_starts_at_true_scale', async () => {
    reviewApi(sideReview());
    renderApp({ path: REVIEW_PATH });
    const group = await screen.findByRole('group', { name: 'Side distance on the map' });
    expect(within(group).getByRole('button', { name: 'True scale' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(group).getByRole('button', { name: 'Side distance × 6' })).toHaveAttribute('aria-pressed', 'false');
    expect(document.querySelectorAll('.track-map .track-far')).toHaveLength(0);
    expect(document.querySelectorAll('.track-map .track-peak')).toHaveLength(0);
    expect(screen.queryByText(/drawn 6 times farther/)).not.toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Map of the reference line and your line' })).toBeInTheDocument();
  });

  it('map_side_distance_six_times_draws_your_line_from_the_reference_line', async () => {
    reviewApi(sideReview());
    renderApp({ path: REVIEW_PATH });
    await screen.findByRole('group', { name: 'Side distance on the map' });
    const ys = () => attemptYs().map(y => y - referenceY());
    const before = ys();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Side distance × 6' }));
    expect(screen.getByRole('button', { name: 'Side distance × 6' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'True scale' })).toHaveAttribute('aria-pressed', 'false');
    const after = ys();
    expect(after).toHaveLength(before.length);
    expect(after[3]! / after[0]!).toBeCloseTo(-5, 1);
    expect(after[0]).toBeGreaterThan(0);
    expect(after[3]).toBeLessThan(0);
    expect(before[0]! / before[3]!).toBeCloseTo(-0.2, 1);
    expect(screen.getByRole('group', { name: 'Map of the reference line and your line. The side distance of your line is drawn 6 times larger.' })).toBeInTheDocument();
  });

  it('map_side_distance_marks_the_parts_beyond_the_side_cue_distance', async () => {
    reviewApi(sideReview());
    renderApp({ path: REVIEW_PATH });
    await screen.findByRole('group', { name: 'Side distance on the map' });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Side distance × 6' }));
    const far = [...document.querySelectorAll('.track-map .track-far')];
    expect(far).toHaveLength(1);
    expect(far[0]!.getAttribute('points')!.split(' ')).toHaveLength(2);
    expect(document.querySelector('.map-legend')).toHaveTextContent('reference line');
    expect(document.querySelector('.map-legend')).toHaveTextContent('you');
    expect(document.querySelector('.map-legend')).toHaveTextContent('more than 2 m from the line');
  });

  it('map_side_distance_gives_one_dot_per_turn_zone_with_a_tip', async () => {
    reviewApi(sideReview());
    renderApp({ path: REVIEW_PATH });
    await screen.findByRole('group', { name: 'Side distance on the map' });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Side distance × 6' }));
    expect(document.querySelectorAll('.track-map .track-peak')).toHaveLength(2);
    expect(document.querySelector('.peak-tip')).toBeNull();
    await user.hover(screen.getByRole('button', { name: 'T2 1.2 m right, at 14 m' }));
    expect([...document.querySelectorAll('.peak-tip text')].map(text => text.textContent)).toEqual(['T2 · 1.2 m right', 'at 14 m']);
    await user.click(screen.getByRole('button', { name: 'True scale' }));
    expect(document.querySelectorAll('.track-map .track-peak')).toHaveLength(0);
  });

  it('map_switch_is_not_stored', async () => {
    reviewApi(sideReview());
    const view = renderApp({ path: REVIEW_PATH });
    await screen.findByRole('group', { name: 'Side distance on the map' });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Side distance × 6' }));
    view.unmount();
    renderApp({ path: REVIEW_PATH });
    const group = await screen.findByRole('group', { name: 'Side distance on the map' });
    expect(within(group).getByRole('button', { name: 'True scale' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('phone_map_switch_is_above_the_map', async () => {
    setViewportWidth(390);
    reviewApi(sideReview());
    renderApp({ path: REVIEW_PATH });
    const group = await screen.findByRole('group', { name: 'Side distance on the map' });
    const map = document.querySelector('.track-map')!;
    expect(group.compareDocumentPosition(map) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(group.closest('.map-panel-actions')).not.toBeNull();
  });

  it('time_lost_readout_has_no_distance', async () => {
    reviewApi();
    renderApp({ path: REVIEW_PATH });
    const time = await screen.findByRole('slider', { name: 'Time lost to the reference, s' });
    expect(time.closest('.channel')!.querySelector('.channel-label span:last-child')!.textContent).toMatch(/^[+-]?\d\.\d\d s$/);
  });

  it('side_distance_chart_is_140_px_on_a_phone', async () => {
    setViewportWidth(390);
    reviewApi();
    renderApp({ path: REVIEW_PATH });
    await screen.findByRole('slider', { name: 'Distance from the reference line, m' });
    const heights = [...document.querySelectorAll('.channel svg')].map(svg => (svg as SVGElement).style.height);
    expect(heights).toEqual(['120px', '120px', '120px', '140px', '120px']);
  });

  it('drive_drives_the_exercise_of_the_attempt', async () => {
    const api = reviewApi().on('POST /api/training/arm', { status: 201, body: { captureId: 'cap-9', exerciseId: EXERCISE_ID, referenceId: 'ref-demo' } });
    renderApp({ path: REVIEW_PATH });
    const drive = await screen.findByRole('button', { name: 'Drive' });
    expect(drive).toHaveClass('yellow');
    expect(screen.queryByText('Drive again')).toBeNull();
    await userEvent.setup().click(drive);
    await waitFor(() => expect(window.location.pathname).toBe(`/exercises/${attemptSummary().exerciseId}/drive`));
    expect(api.calls.find(call => call.path === '/api/training/arm')?.body).toEqual({ exerciseId: attemptSummary().exerciseId });
  });

  it('review_header_shows_time_gap_and_breadcrumb', async () => {
    reviewApi(review({ referenceTimeMs: 25470 }));
    renderApp({ path: REVIEW_PATH });
    expect(await screen.findByRole('heading', { level: 2, name: 'Attempt 1 · 0:27.100 +1.63 s' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'All attempts' })).toBeNull();
    const crumbs = await screen.findByRole('navigation', { name: 'Breadcrumb' });
    expect(crumbs).toHaveTextContent('Exercises / Yangwang Experience / Racing Lines');
    expect(within(crumbs).getByRole('link', { name: 'Exercises' })).toHaveAttribute('href', '/');
  });

  it('review_lede_says_the_times_come_from_the_game', async () => {
    reviewApi(review(), attemptSummary({ startedAt: new Date(2026, 10, 16, 14, 5).toISOString() }));
    renderApp({ path: REVIEW_PATH });
    expect(await screen.findByText('16 Nov 2026, 14:05. Times from the game. Gap to the compared reference.')).toBeInTheDocument();
  });

  it('review_lede_of_an_aborted_attempt_names_the_reason', async () => {
    const startedAt = new Date(2026, 10, 16, 14, 5).toISOString();
    reviewApi(review(), attemptSummary({ completion: 'aborted', reason: 'left-track', timeMs: null, gapToBestMs: null, startedAt }));
    renderApp({ path: REVIEW_PATH });
    expect(await screen.findByText('16 Nov 2026, 14:05. The attempt did not finish (left the track).')).toBeInTheDocument();
  });

  it('review_lede_of_an_aborted_attempt_without_a_reason', async () => {
    const startedAt = new Date(2026, 10, 16, 14, 5).toISOString();
    reviewApi(review(), attemptSummary({ completion: 'aborted', reason: null, timeMs: null, gapToBestMs: null, startedAt }));
    renderApp({ path: REVIEW_PATH });
    expect(await screen.findByText('16 Nov 2026, 14:05. The attempt did not finish.')).toBeInTheDocument();
  });

  it('aborted_attempt_cannot_become_a_reference', async () => {
    reviewApi(review(), attemptSummary({ completion: 'aborted', reason: 'left-track', timeMs: null, gapToBestMs: null }));
    renderApp({ path: REVIEW_PATH });
    expect(await screen.findByRole('heading', { level: 2, name: 'Attempt 1 · No time' })).toBeInTheDocument();
    expect(await screen.findByText('Only a complete attempt can become a reference.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Use this attempt as a reference' })).not.toBeInTheDocument();
    expect(screen.getByText('Only a complete attempt can become a reference.').nextElementSibling).toBe(screen.getByRole('button', { name: 'Delete attempt' }));
  });

  it('promote_refused_as_not_complete_shows_the_error', async () => {
    const api = reviewApi().on(`POST /api/attempts/${ATTEMPT_ID}/promote`, {
      status: 409,
      body: { code: 'not-complete' }
    });
    renderApp({ path: REVIEW_PATH });
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Use this attempt as a reference' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Only a complete attempt can become a reference.');
    expect(api.called(`POST /api/attempts/${ATTEMPT_ID}/promote`)).toBe(true);
  });

  it('promote_success_is_a_status', async () => {
    reviewApi().on(`POST /api/attempts/${ATTEMPT_ID}/promote`, { status: 201, body: reference({ id: 'ref-attempt', origin: 'attempt' }) });
    renderApp({ path: REVIEW_PATH });
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Use this attempt as a reference' }));
    expect(await screen.findByText('This attempt is now the active reference. The demonstration stays in the reference history.')).toHaveAttribute('role', 'status');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('review_has_no_voice_text_and_no_voice_row', async () => {
    reviewApi();
    renderApp({ path: REVIEW_PATH });
    await screen.findByRole('heading', { level: 2, name: /^Attempt 1 · / });
    expect(screen.queryByText('Voice', { selector: 'span' })).toBeNull();
    expect(await screen.findByText('Source', { selector: 'span' })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/with voice|without voice/i);
  });

  it('review_without_voiced_brake_has_no_reaction_section', async () => {
    reviewApi();
    renderApp({ path: REVIEW_PATH });
    await screen.findByRole('heading', { name: 'Differences by turn' });
    expect(screen.queryByRole('region', { name: 'Brake reaction' })).not.toBeInTheDocument();
  });

  it('review_delete_attempt_confirms_and_returns_to_attempts', async () => {
    const api = reviewApi()
      .on(`GET /api/exercises/${EXERCISE_ID}/attempts`, {
        bestMs: 27100,
        days: [{ date: '2026-11-16', bestMs: 27100, attempts: [attemptSummary()] }]
      })
      .on('POST /api/attempts/delete', { deleted: 1 });
    renderApp({ path: REVIEW_PATH });
    const remove = await screen.findByRole('button', { name: 'Delete attempt' });
    const promote = screen.getByRole('button', { name: 'Use this attempt as a reference' });
    expect(remove).toHaveClass('btn', 'danger');
    expect(promote.nextElementSibling).toBe(remove);
    expect(screen.queryByText('Removes the attempt with its cues and differences.')).not.toBeInTheDocument();
    await userEvent.click(remove);
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete attempt 1?' });
    expect(await within(dialog).findByText(/Your best:/)).toHaveTextContent('Your best: 0:27.100 → no time');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete attempt' }));
    await waitFor(() => expect(window.location.pathname).toBe(`/exercises/${EXERCISE_ID}/attempts`));
    expect(api.calls.find(call => call.path === '/api/attempts/delete')!.body).toEqual({ ids: [ATTEMPT_ID] });
  });

  it('no_delete_button_ends_with_an_ellipsis', async () => {
    reviewApi();
    renderApp({ path: REVIEW_PATH });
    await screen.findByRole('button', { name: 'Delete attempt' });
    for (const button of screen.getAllByRole('button')) expect(button.textContent).not.toMatch(/…$/);
  });

  it('review_keeps_the_exercise_tabs', async () => {
    reviewApi();
    renderApp({ path: REVIEW_PATH });
    const tabs = await screen.findByRole('navigation', { name: 'Exercise' });
    expect(within(tabs).getByRole('link', { name: /^Attempts/ })).toHaveAttribute('aria-current', 'page');
    expect(within(tabs).getByRole('link', { name: 'Cues' })).toHaveAttribute('href', expect.stringMatching(/\/cues$/));
    expect(screen.queryByRole('link', { name: 'All attempts' })).toBeNull();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(exercise().name);
    expect(screen.getByRole('heading', { level: 2, name: /^Attempt \d+ · / })).toBeInTheDocument();
    const crumb = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(crumb).toHaveTextContent(`Exercises / ${exercise().name}`);
  });

  it('review_shows_without_the_exercise', async () => {
    reviewApi().on(`GET /api/exercises/${EXERCISE_ID}`, { status: 500, body: { code: 'server-error' } });
    renderApp({ path: REVIEW_PATH });
    expect(await screen.findByRole('heading', { name: /^Attempt \d+ · / })).toBeInTheDocument();
    expect(await screen.findByRole('slider', { name: 'Speed, km/h' })).toBeInTheDocument();
    expect(document.querySelector('.track-map')).not.toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Exercise' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Drive' })).toBeInTheDocument();
  });

  it('review_drive_opens_the_right_column', async () => {
    reviewApi();
    renderApp({ path: REVIEW_PATH });
    const differences = await screen.findByRole('heading', { name: 'Differences by turn' });
    const drive = screen.getByRole('button', { name: 'Drive' });
    expect(drive.compareDocumentPosition(differences) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(document.querySelector('.track-map')!.compareDocumentPosition(drive) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('review_drive_follows_the_lede_on_a_phone', async () => {
    setViewportWidth(390);
    reviewApi();
    renderApp({ path: REVIEW_PATH });
    await screen.findByRole('heading', { name: 'Differences by turn' });
    const lede = screen.getByText(/Times from the game\./);
    const drive = screen.getByRole('button', { name: 'Drive' });
    expect(lede.compareDocumentPosition(drive) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(drive.compareDocumentPosition(document.querySelector('.track-map')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('review_map_panel_opens_the_view_with_the_differences', async () => {
    reviewApi();
    renderApp({ path: REVIEW_PATH });
    const user = userEvent.setup();
    const panel = await screen.findByRole('region', { name: 'Your line' });
    const buttons = within(panel).getAllByRole('button').filter(button => !button.closest('svg'));
    expect(buttons.map(button => button.textContent)).toEqual(['True scale', `Side distance × 6`, 'View']);
    expect([...panel.querySelectorAll('.legend span')].map(span => span.textContent)).toEqual(['reference line', 'you', 'turn', 'A gap in your line is a place without a match']);
    await user.click(within(panel).getByRole('button', { name: 'View the map in full screen' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('checkbox', { name: 'Differences' })).toBeChecked();
    const list = within(dialog).getByRole('complementary', { name: 'Differences' });
    expect(within(list).getAllByRole('button')).toHaveLength(2);
    expect(dialog.querySelector('.track-attempt, [data-segment="attempt"]')).not.toBeNull();
    expect(screen.queryByText('Map orientation is not confirmed')).toBeNull();
  });
});
