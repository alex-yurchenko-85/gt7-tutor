import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { KPH_PER_MPS } from '@gt7/contracts';
import { exercise, exerciseApi, reference } from './fixtures.ts';
import { attemptSummary, review, withGap } from './review-fixtures.ts';
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
    .on('GET /api/attempts/a0000000-0000-4000-8000-000000000001', attempt)
    .on('GET /api/attempts/a0000000-0000-4000-8000-000000000001/review', (_body: unknown, url: URL) => {
      requestedReferences.push(url.searchParams.get('referenceId'));
      return url.searchParams.get('referenceId') === 'ref-attempt' ? review({ referenceId: 'ref-attempt', findings: [] }) : data;
    })
    .on('GET /api/exercises/e0000000-0000-4000-8000-000000000001/references', [
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
    setViewportWidth(1280);
    reviewApi();
    renderApp({ path: '/attempts/a0000000-0000-4000-8000-000000000001/review' });
    const speed = await screen.findByRole('slider', { name: 'Speed, km/h' });
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
    setViewportWidth(1280);
    reviewApi();
    renderApp({ path: '/attempts/a0000000-0000-4000-8000-000000000001/review' });
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
    setViewportWidth(1280);
    reviewApi();
    const view = renderApp({ path: '/attempts/a0000000-0000-4000-8000-000000000001/review' });
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
    setViewportWidth(1280);
    reviewApi();
    renderApp({ path: '/attempts/a0000000-0000-4000-8000-000000000001/review' });
    const list = await screen.findByRole('region', { name: 'Differences by turn' });
    const off = within(list).getByRole('button', { name: /16 m\. Up to 2 m from the reference line/ });
    await userEvent.setup().click(off);
    expect(off).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('slider', { name: 'Speed, km/h' })).toHaveAttribute('aria-valuenow', '16');
  });

  it('unmatched_gap_breaks_the_line', async () => {
    setViewportWidth(1280);
    reviewApi(withGap(review()));
    renderApp({ path: '/attempts/a0000000-0000-4000-8000-000000000001/review' });
    await screen.findByRole('slider', { name: 'Speed, km/h' });
    expect(document.querySelectorAll('.track-map [data-segment="attempt"]')).toHaveLength(2);
    expect(document.querySelectorAll('[data-chart="speed"] [data-series="you"]')).toHaveLength(2);
    expect(document.querySelectorAll('[data-chart="speed"] [data-series="ref"]')).toHaveLength(1);
  });

  it('review_can_switch_reference', async () => {
    setViewportWidth(1280);
    reviewApi();
    renderApp({ path: '/attempts/a0000000-0000-4000-8000-000000000001/review' });
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
    setViewportWidth(1280);
    reviewApi();
    renderApp({ path: '/attempts/a0000000-0000-4000-8000-000000000001/review' });
    expect(await screen.findByRole('heading', { name: 'Differences by turn' })).toBeInTheDocument();
    expect(screen.getByText(/The reference is one recorded drive, not the best possible line/)).toBeInTheDocument();
    expect(screen.queryByText(/mistake/)).toBeNull();
  });

  it('phone_review_shows_map_and_differences_first', async () => {
    setViewportWidth(390);
    reviewApi();
    renderApp({ path: '/attempts/a0000000-0000-4000-8000-000000000001/review' });
    const heading = await screen.findByRole('heading', { name: 'Differences by turn' });
    const map = document.querySelector('.track-map')!;
    const speed = screen.getByRole('slider', { name: 'Speed, km/h' });
    expect(map.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(heading.compareDocumentPosition(speed) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('review_lists_corners_inside_or_outside', async () => {
    setViewportWidth(1280);
    const corners = [
      { number: 1, turnInSM: 461, apexSM: 519, radiusM: 43, apexSpeedMps: 89 / KPH_PER_MPS, zoneFromSM: 461, zoneToSM: 577, outsideM: 4.84, speedMps: 84.2 / KPH_PER_MPS },
      { number: 2, turnInSM: 691, apexSM: 737, radiusM: 66, apexSpeedMps: 110 / KPH_PER_MPS, zoneFromSM: 691, zoneToSM: 783, outsideM: 0.4, speedMps: 111 / KPH_PER_MPS },
      { number: 3, turnInSM: 834, apexSM: 870, radiusM: 84, apexSpeedMps: 123 / KPH_PER_MPS, zoneFromSM: 834, zoneToSM: 900, outsideM: -1.26, speedMps: null },
      { number: 4, turnInSM: 900, apexSM: 950, radiusM: 84, apexSpeedMps: 123 / KPH_PER_MPS, zoneFromSM: 900, zoneToSM: 1000, outsideM: null, speedMps: null }
    ];
    reviewApi(review({ corners }));
    renderApp({ path: '/attempts/a0000000-0000-4000-8000-000000000001/review' });
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
    setViewportWidth(1280);
    const corners = [{ number: 1, turnInSM: 2, apexSM: 4, radiusM: 43, apexSpeedMps: 88.6 / KPH_PER_MPS, zoneFromSM: 2, zoneToSM: 6, outsideM: 0, speedMps: 84.2 / KPH_PER_MPS }];
    const findings = [{ kind: 'slow-corner' as const, eventKey: 'brake@4', sM: 4, size: 15.6 / KPH_PER_MPS, unit: 'm/s' as const, turn: 1 }];
    reviewApi(review({ corners, findings }));
    renderApp({ path: '/attempts/a0000000-0000-4000-8000-000000000001/review' });
    const list = await screen.findByRole('region', { name: 'Corners' });
    expect(within(list).getAllByRole('listitem')[0]).toHaveTextContent('84 km/h at the apex, reference 89 km/h');
    const differences = screen.getByRole('region', { name: 'Differences by turn' });
    expect(within(differences).getByRole('button', { name: /16 km\/h slower in the corner/ })).toBeInTheDocument();
  });

  it('review_shows_brake_reaction_of_the_attempt', async () => {
    setViewportWidth(1280);
    reviewApi(review({ reactions: [{ eventKey: 'brake@10', reactionMs: 640 }] }));
    renderApp({ path: '/attempts/a0000000-0000-4000-8000-000000000001/review' });
    const list = await screen.findByRole('region', { name: 'Brake reaction' });
    expect(list).toHaveTextContent('10 m: you started to brake 0.6 s after the cue');
  });

  it('review_without_corners_shows_whole_section_group', async () => {
    setViewportWidth(1280);
    reviewApi();
    renderApp({ path: '/attempts/a0000000-0000-4000-8000-000000000001/review' });
    const list = await screen.findByRole('region', { name: 'Differences by turn' });
    const groups = within(list).getAllByRole('group').filter(group => group.getAttribute('aria-label') !== null);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveAccessibleName('Whole section');
    expect(within(groups[0]!).getAllByRole('button')).toHaveLength(2);
    expect(document.querySelectorAll('[data-band]')).toHaveLength(0);
  });

  it('review_groups_follow_the_track_and_sort_by_time_lost', async () => {
    setViewportWidth(1280);
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
    renderApp({ path: '/attempts/a0000000-0000-4000-8000-000000000001/review' });
    const list = await screen.findByRole('region', { name: 'Differences by turn' });
    const order = within(list).getByRole('group', { name: 'Order of the turns' });
    expect(within(order).getByRole('radio', { name: 'Track' })).toBeChecked();
    const turnGroups = () => within(list).getAllByRole('group').filter(group => group !== order);
    expect(turnGroups().map(group => group.getAttribute('aria-label'))).toEqual(['T1 · 0.12 s gained', 'T2 · 0.50 s lost']);
    const user = userEvent.setup();
    await user.click(within(order).getByRole('radio', { name: 'Time lost' }));
    expect(turnGroups().map(group => group.getAttribute('aria-label'))).toEqual(['T2 · 0.50 s lost', 'T1 · 0.12 s gained']);
    expect(within(list).getByText(/^Largest time lost first\./)).toBeInTheDocument();
    const groups = turnGroups();
    expect(within(groups[0]!).getAllByRole('button')).toHaveLength(2);
    await user.click(within(groups[1]!).getByRole('button', { name: /4 m\. Braked 2 m earlier/ }));
    expect(screen.getByRole('slider', { name: 'Speed, km/h' })).toHaveAttribute('aria-valuenow', '4');
    expect(document.querySelectorAll('[data-chart="speed"] [data-band]')).toHaveLength(0);
  });

  it('difference_header_shows_the_turn_and_the_time_lost', async () => {
    setViewportWidth(1280);
    reviewApi(
      review({
        findings: [{ kind: 'brake-late', eventKey: 'brake@4', sM: 4, size: 6, unit: 'm', turn: 1 }],
        turnLosses: [{ turn: 1, fromSM: 346, toSM: 462, lostMs: 300 }]
      })
    );
    renderApp({ path: '/attempts/a0000000-0000-4000-8000-000000000001/review' });
    const list = await screen.findByRole('region', { name: 'Differences by turn' });
    expect(within(list).getByRole('group', { name: 'T1 · 0.30 s lost' })).toBeInTheDocument();
  });

  it('difference_header_has_only_the_turn_when_no_time_is_lost', async () => {
    setViewportWidth(1280);
    reviewApi(
      review({
        findings: [{ kind: 'brake-late', eventKey: 'brake@4', sM: 4, size: 6, unit: 'm', turn: 1 }],
        turnLosses: [{ turn: 1, fromSM: 346, toSM: 462, lostMs: null }]
      })
    );
    renderApp({ path: '/attempts/a0000000-0000-4000-8000-000000000001/review' });
    const list = await screen.findByRole('region', { name: 'Differences by turn' });
    expect(within(list).getByRole('group', { name: 'T1' })).toBeInTheDocument();
    expect(list).not.toHaveTextContent(/346|462/);
  });

  it('charts_shade_the_turn_zone_of_each_corner', async () => {
    setViewportWidth(1280);
    const corners = [
      { number: 1, turnInSM: 2, apexSM: 4, radiusM: 40, apexSpeedMps: 90 / KPH_PER_MPS, zoneFromSM: 2, zoneToSM: 6, outsideM: 0, speedMps: 88 / KPH_PER_MPS },
      { number: 2, turnInSM: 12, apexSM: 16, radiusM: 40, apexSpeedMps: 90 / KPH_PER_MPS, zoneFromSM: 12, zoneToSM: 18, outsideM: 0, speedMps: 88 / KPH_PER_MPS }
    ];
    reviewApi(review({ corners }));
    renderApp({ path: '/attempts/a0000000-0000-4000-8000-000000000001/review' });
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
    setViewportWidth(1280);
    const corners = [
      { number: 1, turnInSM: 2, apexSM: 4, radiusM: 40, apexSpeedMps: 90 / KPH_PER_MPS, zoneFromSM: 2, zoneToSM: 6, outsideM: 0, speedMps: 88 / KPH_PER_MPS },
      { number: 2, turnInSM: 12, apexSM: 16, radiusM: 40, apexSpeedMps: 90 / KPH_PER_MPS, zoneFromSM: 12, zoneToSM: 12, outsideM: 0, speedMps: 88 / KPH_PER_MPS },
      { number: 3, turnInSM: 14, apexSM: 16, radiusM: 40, apexSpeedMps: 90 / KPH_PER_MPS, zoneFromSM: 14, zoneToSM: 13, outsideM: 0, speedMps: 88 / KPH_PER_MPS }
    ];
    reviewApi(review({ corners }));
    renderApp({ path: '/attempts/a0000000-0000-4000-8000-000000000001/review' });
    await screen.findByRole('slider', { name: 'Speed, km/h' });
    expect([...document.querySelectorAll('[data-chart="speed"] [data-band]')].map(band => band.getAttribute('data-band'))).toEqual(['T1']);
    expect([...document.querySelectorAll('[data-chart="speed"] .turn-label')].map(label => label.textContent)).toEqual(['T1']);
  });

  it('two_bands_two_labels', async () => {
    setViewportWidth(1280);
    const corners = [
      { number: 1, turnInSM: 2, apexSM: 4, radiusM: 40, apexSpeedMps: 90 / KPH_PER_MPS, zoneFromSM: 2, zoneToSM: 6, outsideM: 0, speedMps: 88 / KPH_PER_MPS },
      { number: 2, turnInSM: 12, apexSM: 16, radiusM: 40, apexSpeedMps: 90 / KPH_PER_MPS, zoneFromSM: 12, zoneToSM: 18, outsideM: 0, speedMps: 88 / KPH_PER_MPS }
    ];
    reviewApi(review({ corners }));
    renderApp({ path: '/attempts/a0000000-0000-4000-8000-000000000001/review' });
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
    setViewportWidth(1280);
    reviewApi();
    renderApp({ path: '/attempts/a0000000-0000-4000-8000-000000000001/review' });
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
    setViewportWidth(1280);
    reviewApi();
    renderApp({ path: '/attempts/a0000000-0000-4000-8000-000000000001/review' });
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
    setViewportWidth(1280);
    reviewApi();
    renderApp({ path: '/attempts/a0000000-0000-4000-8000-000000000001/review' });
    await screen.findByRole('slider', { name: 'Speed, km/h' });
    const titles = [...document.querySelectorAll('.channel .channel-label span:first-child')].map(item => item.textContent);
    expect(titles).toEqual(['Speed, km/h', 'Throttle', 'Brake', 'Distance from the reference line, m', 'Time lost to the reference, s']);
  });

  it('side_distance_axis_uses_words_and_unsigned_numbers', async () => {
    setViewportWidth(1280);
    reviewApi();
    renderApp({ path: '/attempts/a0000000-0000-4000-8000-000000000001/review' });
    await screen.findByRole('slider', { name: 'Distance from the reference line, m' });
    const labels = [...document.querySelectorAll('[data-chart="side"]')[0]!.closest('.channel')!.querySelectorAll('.y-axis span')].map(item => item.textContent);
    expect(labels[0]).toBe('right');
    expect(labels.at(-1)).toBe('left');
    expect(labels).toContain('line');
    expect(labels.filter(label => label !== 'right' && label !== 'left' && label !== 'line').every(label => /^\d+(\.\d+)?$/.test(label!))).toBe(true);
  });

  it('side_distance_chart_draws_you_against_the_reference_line', async () => {
    setViewportWidth(1280);
    reviewApi();
    renderApp({ path: '/attempts/a0000000-0000-4000-8000-000000000001/review' });
    await screen.findByRole('slider', { name: 'Distance from the reference line, m' });
    const plot = document.querySelector('[data-chart="side"]')!;
    expect(plot.querySelectorAll('[data-series="ref"]')).toHaveLength(1);
    expect(plot.querySelectorAll('[data-series="you"]')).toHaveLength(1);
    expect(plot.querySelectorAll('[data-series="ink"]')).toHaveLength(0);
    expect(plot.querySelectorAll('.chart-area')).toHaveLength(1);
  });

  it('side_distance_legend_names_the_cue_distance', async () => {
    setViewportWidth(1280);
    reviewApi();
    renderApp({ path: '/attempts/a0000000-0000-4000-8000-000000000001/review' });
    await screen.findByRole('slider', { name: 'Distance from the reference line, m' });
    const legend = document.querySelector('.side-legend')!;
    expect(legend).toHaveTextContent('reference line');
    expect(legend).toHaveTextContent('you');
    expect(legend).toHaveTextContent('side cue distance, 2 m');
  });

  it('side_distance_legend_has_no_cue_entry_when_off', async () => {
    setViewportWidth(1280);
    reviewApi(review(), attemptSummary(), exercise({ sideCueDistanceM: null }));
    renderApp({ path: '/attempts/a0000000-0000-4000-8000-000000000001/review' });
    await screen.findByRole('slider', { name: 'Distance from the reference line, m' });
    const legend = document.querySelector('.side-legend')!;
    expect(legend).toHaveTextContent('reference line');
    expect(legend).not.toHaveTextContent('side cue distance');
  });

  it('side_distance_readout_texts', async () => {
    setViewportWidth(1280);
    const base = review();
    const lat = base.attempt.lat.map((_, i) => (i === 0 ? 0 : i === 1 ? 0.4 : i === 2 ? -5 : i === 3 ? 5.04 : i === 4 ? null : 1));
    reviewApi({ ...base, attempt: { ...base.attempt, lat } });
    renderApp({ path: '/attempts/a0000000-0000-4000-8000-000000000001/review' });
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
    setViewportWidth(1280);
    reviewApi();
    renderApp({ path: '/attempts/a0000000-0000-4000-8000-000000000001/review' });
    await screen.findByRole('slider', { name: 'Distance from the reference line, m' });
    await waitFor(() => expect(document.querySelectorAll('[data-chart="side"] .chart-threshold')).toHaveLength(2));
    expect(document.querySelectorAll('[data-chart="speed"] .chart-threshold')).toHaveLength(0);
    const ys = [...document.querySelectorAll('[data-chart="side"] .chart-threshold')].map(line => Number(line.getAttribute('y1')));
    const zero = Number(document.querySelector('[data-chart="side"] .chart-zero')!.getAttribute('y1'));
    expect(ys[0]! + ys[1]!).toBeCloseTo(zero * 2, 5);
  });

  it('off_has_no_threshold_marks', async () => {
    setViewportWidth(1280);
    reviewApi(sideReview(), attemptSummary(), exercise({ sideCueDistanceM: null }));
    renderApp({ path: '/attempts/a0000000-0000-4000-8000-000000000001/review' });
    await screen.findByRole('slider', { name: 'Distance from the reference line, m' });
    expect(document.querySelectorAll('.chart-threshold')).toHaveLength(0);
    expect(document.querySelectorAll('[data-chart="side"] [data-series="you"]')).toHaveLength(1);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Side distance × 6' }));
    expect(document.querySelectorAll('.track-map [data-segment="attempt"]')).toHaveLength(1);
    expect(document.querySelectorAll('.track-map .track-far')).toHaveLength(0);
    expect([...document.querySelectorAll('.track-map .track-callout')].map(callout => callout.textContent)).toEqual(['T1 · 5.0 m leftat 6 m', 'T2 · 1.2 m rightat 14 m']);
    expect(document.querySelector('.map-legend')).not.toHaveTextContent('from the line');
  });

  it('map_switch_starts_at_true_scale', async () => {
    setViewportWidth(1280);
    reviewApi(sideReview());
    renderApp({ path: '/attempts/a0000000-0000-4000-8000-000000000001/review' });
    const group = await screen.findByRole('group', { name: 'Side distance on the map' });
    expect(within(group).getByRole('button', { name: 'True scale' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(group).getByRole('button', { name: 'Side distance × 6' })).toHaveAttribute('aria-pressed', 'false');
    expect(document.querySelectorAll('.track-map .track-far')).toHaveLength(0);
    expect(document.querySelectorAll('.track-map .track-callout')).toHaveLength(0);
    expect(screen.queryByText(/drawn 6 times farther/)).not.toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Map of the reference line and your line' })).toBeInTheDocument();
  });

  it('map_side_distance_six_times_draws_your_line_from_the_reference_line', async () => {
    setViewportWidth(1280);
    reviewApi(sideReview());
    renderApp({ path: '/attempts/a0000000-0000-4000-8000-000000000001/review' });
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
    expect(screen.getByText('Your line is drawn 6 times farther from the reference line than it was, so that a difference of 1 m shows. The labels give the true distance at the largest point of each turn.')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Map of the reference line and your line. The side distance of your line is drawn 6 times larger. T1 5.0 m left, T2 1.2 m right.' })).toBeInTheDocument();
  });

  it('map_side_distance_marks_the_parts_beyond_the_side_cue_distance', async () => {
    setViewportWidth(1280);
    reviewApi(sideReview());
    renderApp({ path: '/attempts/a0000000-0000-4000-8000-000000000001/review' });
    await screen.findByRole('group', { name: 'Side distance on the map' });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Side distance × 6' }));
    const far = [...document.querySelectorAll('.track-map .track-far')];
    expect(far).toHaveLength(1);
    expect(far[0]!.getAttribute('points')!.split(' ')).toHaveLength(2);
    expect(document.querySelector('.map-legend')).toHaveTextContent('reference line');
    expect(document.querySelector('.map-legend')).toHaveTextContent('you');
    expect(document.querySelector('.map-legend')).toHaveTextContent('more than 2 m from the line');
  });

  it('map_side_distance_gives_one_label_per_turn_zone', async () => {
    setViewportWidth(1280);
    reviewApi(sideReview());
    renderApp({ path: '/attempts/a0000000-0000-4000-8000-000000000001/review' });
    await screen.findByRole('group', { name: 'Side distance on the map' });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Side distance × 6' }));
    const callouts = [...document.querySelectorAll('.track-map .track-callout')];
    expect(callouts.map(callout => [callout.querySelector('.callout-title')!.textContent, callout.querySelector('.callout-detail')!.textContent])).toEqual([
      ['T1 · 5.0 m left', 'at 6 m'],
      ['T2 · 1.2 m right', 'at 14 m']
    ]);
    await userEvent.setup().click(screen.getByRole('button', { name: 'True scale' }));
    expect(document.querySelectorAll('.track-map .track-callout')).toHaveLength(0);
  });

  it('map_switch_is_not_stored', async () => {
    setViewportWidth(1280);
    reviewApi(sideReview());
    const view = renderApp({ path: '/attempts/a0000000-0000-4000-8000-000000000001/review' });
    await screen.findByRole('group', { name: 'Side distance on the map' });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Side distance × 6' }));
    view.unmount();
    renderApp({ path: '/attempts/a0000000-0000-4000-8000-000000000001/review' });
    const group = await screen.findByRole('group', { name: 'Side distance on the map' });
    expect(within(group).getByRole('button', { name: 'True scale' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('phone_map_switch_is_above_the_map', async () => {
    setViewportWidth(390);
    reviewApi(sideReview());
    renderApp({ path: '/attempts/a0000000-0000-4000-8000-000000000001/review' });
    const group = await screen.findByRole('group', { name: 'Side distance on the map' });
    const map = document.querySelector('.track-map')!;
    expect(group.compareDocumentPosition(map) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(group.closest('.map-head')).not.toBeNull();
  });

  it('time_lost_readout_has_no_distance', async () => {
    setViewportWidth(1280);
    reviewApi();
    renderApp({ path: '/attempts/a0000000-0000-4000-8000-000000000001/review' });
    const time = await screen.findByRole('slider', { name: 'Time lost to the reference, s' });
    expect(time.closest('.channel')!.querySelector('.channel-label span:last-child')!.textContent).toMatch(/^[+-]?\d\.\d\d s$/);
  });

  it('side_distance_chart_is_140_px_on_a_phone', async () => {
    setViewportWidth(390);
    reviewApi();
    renderApp({ path: '/attempts/a0000000-0000-4000-8000-000000000001/review' });
    await screen.findByRole('slider', { name: 'Distance from the reference line, m' });
    const heights = [...document.querySelectorAll('.channel svg')].map(svg => (svg as SVGElement).style.height);
    expect(heights).toEqual(['120px', '120px', '120px', '140px', '120px']);
  });

  it('review_has_drive_again_link', async () => {
    setViewportWidth(1280);
    reviewApi();
    renderApp({ path: '/attempts/a0000000-0000-4000-8000-000000000001/review' });
    expect(await screen.findByRole('link', { name: 'Drive again' })).toHaveAttribute('href', '/drive');
  });

  it('drive_again_drives_the_exercise_of_the_attempt', async () => {
    setViewportWidth(1280);
    reviewApi();
    window.localStorage.setItem(`gt7.currentExercise.${USER.id}`, 'e0000000-0000-4000-8000-000000000002');
    renderApp({ path: '/attempts/a0000000-0000-4000-8000-000000000001/review' });
    await userEvent.setup().click(await screen.findByRole('link', { name: 'Drive again' }));
    expect(window.location.pathname).toBe('/drive');
    expect(window.localStorage.getItem(`gt7.currentExercise.${USER.id}`)).toBe(attemptSummary().exerciseId);
  });

  it('review_header_shows_time_gap_and_breadcrumb', async () => {
    setViewportWidth(1280);
    reviewApi(review({ referenceTimeMs: 25470 }));
    renderApp({ path: '/attempts/a0000000-0000-4000-8000-000000000001/review' });
    expect(await screen.findByRole('heading', { level: 1, name: 'Attempt 1 · 0:27.100 +1.63 s' })).toBeInTheDocument();
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(crumbs).getByRole('link', { name: 'Attempts' })).toHaveAttribute('href', '/exercises/e0000000-0000-4000-8000-000000000001/attempts');
    expect(await within(crumbs).findByRole('link', { name: 'Yangwang Experience / Racing Lines' })).toHaveAttribute('href', '/exercises/e0000000-0000-4000-8000-000000000001');
  });

  it('review_gap_compares_game_times', async () => {
    setViewportWidth(1280);
    reviewApi(review({ referenceTimeMs: 25470 }), attemptSummary({ timeMs: 27100 }));
    renderApp({ path: '/attempts/a0000000-0000-4000-8000-000000000001/review' });
    const heading = await screen.findByRole('heading', { level: 1, name: /^Attempt 1 · / });
    await waitFor(() => expect(heading).toHaveTextContent('+1.63 s'));
  });

  it('review_lede_says_the_times_come_from_the_game', async () => {
    setViewportWidth(1280);
    reviewApi(review(), attemptSummary({ startedAt: new Date(2026, 10, 16, 14, 5).toISOString() }));
    renderApp({ path: '/attempts/a0000000-0000-4000-8000-000000000001/review' });
    expect(await screen.findByText('16 Nov 2026, 14:05. Times from the game. Gap to the compared reference.')).toBeInTheDocument();
    const list = await screen.findByRole('region', { name: 'Differences by turn' });
    expect(list).toHaveTextContent('Turns in the order of the section. Time lost is measured from telemetry. Select a difference to put the cursor there.');
  });

  it('review_lede_of_an_aborted_attempt_names_the_reason', async () => {
    setViewportWidth(1280);
    const startedAt = new Date(2026, 10, 16, 14, 5).toISOString();
    reviewApi(review(), attemptSummary({ completion: 'aborted', reason: 'left-track', timeMs: null, gapToBestMs: null, startedAt }));
    renderApp({ path: '/attempts/a0000000-0000-4000-8000-000000000001/review' });
    expect(await screen.findByText('16 Nov 2026, 14:05. The attempt did not finish (left the track).')).toBeInTheDocument();
  });

  it('review_lede_of_an_aborted_attempt_without_a_reason', async () => {
    setViewportWidth(1280);
    const startedAt = new Date(2026, 10, 16, 14, 5).toISOString();
    reviewApi(review(), attemptSummary({ completion: 'aborted', reason: null, timeMs: null, gapToBestMs: null, startedAt }));
    renderApp({ path: '/attempts/a0000000-0000-4000-8000-000000000001/review' });
    expect(await screen.findByText('16 Nov 2026, 14:05. The attempt did not finish.')).toBeInTheDocument();
  });

  it('aborted_attempt_cannot_become_a_reference', async () => {
    setViewportWidth(1280);
    reviewApi(review(), attemptSummary({ completion: 'aborted', reason: 'left-track', timeMs: null, gapToBestMs: null }));
    renderApp({ path: '/attempts/a0000000-0000-4000-8000-000000000001/review' });
    expect(await screen.findByRole('heading', { level: 1, name: 'Attempt 1 · no time' })).toBeInTheDocument();
    expect(await screen.findByText('Only a complete attempt can become a reference.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Use this attempt as a reference' })).not.toBeInTheDocument();
    expect(screen.getByText('Only a complete attempt can become a reference.').nextElementSibling).toBe(screen.getByRole('button', { name: 'Delete this attempt…' }));
  });

  it('promote_refused_as_not_complete_shows_the_error', async () => {
    setViewportWidth(1280);
    const api = reviewApi().on('POST /api/attempts/a0000000-0000-4000-8000-000000000001/promote', {
      status: 409,
      body: { code: 'not-complete', reason: 'Only a complete attempt can become a reference.' }
    });
    renderApp({ path: '/attempts/a0000000-0000-4000-8000-000000000001/review' });
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Use this attempt as a reference' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Only a complete attempt can become a reference.');
    expect(api.called('POST /api/attempts/a0000000-0000-4000-8000-000000000001/promote')).toBe(true);
  });

  it('promote_success_is_a_status', async () => {
    setViewportWidth(1280);
    reviewApi().on('POST /api/attempts/a0000000-0000-4000-8000-000000000001/promote', { status: 201, body: reference({ id: 'ref-attempt', origin: 'attempt' }) });
    renderApp({ path: '/attempts/a0000000-0000-4000-8000-000000000001/review' });
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Use this attempt as a reference' }));
    expect(await screen.findByText('This attempt is now the active reference. The demonstration stays in the reference history.')).toHaveAttribute('role', 'status');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('review_has_no_voice_text_and_no_voice_row', async () => {
    setViewportWidth(1280);
    reviewApi();
    renderApp({ path: '/attempts/a0000000-0000-4000-8000-000000000001/review' });
    await screen.findByRole('heading', { level: 1, name: /^Attempt 1 · / });
    expect(screen.queryByText('Voice', { selector: 'span' })).toBeNull();
    expect(await screen.findByText('Source', { selector: 'span' })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/with voice|without voice/i);
  });

  it('review_lede_shows_date_and_time_of_the_attempt', async () => {
    setViewportWidth(1280);
    reviewApi(review(), attemptSummary({ startedAt: new Date(2026, 10, 16, 14, 5).toISOString() }));
    renderApp({ path: '/attempts/a0000000-0000-4000-8000-000000000001/review' });
    expect(await screen.findByText(/^16 Nov 2026, 14:05\./)).toBeInTheDocument();
  });

  it('review_without_voiced_brake_has_no_reaction_section', async () => {
    setViewportWidth(1280);
    reviewApi();
    renderApp({ path: '/attempts/a0000000-0000-4000-8000-000000000001/review' });
    await screen.findByRole('heading', { name: 'Differences by turn' });
    expect(screen.queryByRole('region', { name: 'Brake reaction' })).not.toBeInTheDocument();
  });

  it('review_delete_attempt_confirms_and_returns_to_attempts', async () => {
    setViewportWidth(1280);
    const api = reviewApi()
      .on('GET /api/exercises/e0000000-0000-4000-8000-000000000001/attempts', {
        bestMs: 27100,
        days: [{ date: '2026-11-16', bestMs: 27100, attempts: [attemptSummary()] }]
      })
      .on('POST /api/attempts/delete', { deleted: 1 });
    renderApp({ path: '/attempts/a0000000-0000-4000-8000-000000000001/review' });
    const remove = await screen.findByRole('button', { name: 'Delete this attempt…' });
    const promote = screen.getByRole('button', { name: 'Use this attempt as a reference' });
    expect(remove).toHaveClass('btn', 'danger');
    expect(promote.nextElementSibling).toBe(remove);
    expect(screen.queryByText('Removes the attempt with its cues and differences.')).not.toBeInTheDocument();
    await userEvent.click(remove);
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete attempt 1?' });
    expect(await within(dialog).findByText(/Your best:/)).toHaveTextContent('Your best: 0:27.100 → no time');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete attempt' }));
    await waitFor(() => expect(window.location.pathname).toBe('/exercises/e0000000-0000-4000-8000-000000000001/attempts'));
    expect(api.calls.find(call => call.path === '/api/attempts/delete')!.body).toEqual({ ids: ['a0000000-0000-4000-8000-000000000001'] });
  });
});
