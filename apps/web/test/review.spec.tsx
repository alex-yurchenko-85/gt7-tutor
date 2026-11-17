import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { exerciseApi, reference } from './fixtures.ts';
import { attemptSummary, review, withGap } from './review-fixtures.ts';
import { renderApp, setViewportWidth, type ApiStub } from './support.tsx';

const requestedReferences: (string | null)[] = [];

function reviewApi(data = review()): ApiStub {
  requestedReferences.length = 0;
  return exerciseApi()
    .on('GET /api/attempts/att-1', attemptSummary())
    .on('GET /api/attempts/att-1/review', (_body: unknown, url: URL) => {
      requestedReferences.push(url.searchParams.get('referenceId'));
      return url.searchParams.get('referenceId') === 'ref-attempt' ? review({ referenceId: 'ref-attempt', findings: [] }) : data;
    })
    .on('GET /api/exercises/ex-1/references', [
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

describe('attempt review', () => {
  it('review_links_cursor_between_charts_and_map', async () => {
    setViewportWidth(1280);
    reviewApi();
    renderApp({ path: '/attempts/att-1/review' });
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

  it('selecting_a_difference_moves_the_cursor', async () => {
    setViewportWidth(1280);
    reviewApi();
    renderApp({ path: '/attempts/att-1/review' });
    const list = await screen.findByRole('region', { name: 'Differences from the reference' });
    const off = within(list).getByRole('button', { name: /16 m\. Up to 2 m from the reference line/ });
    await userEvent.setup().click(off);
    expect(off).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('slider', { name: 'Speed, km/h' })).toHaveAttribute('aria-valuenow', '16');
  });

  it('unmatched_gap_breaks_the_line', async () => {
    setViewportWidth(1280);
    reviewApi(withGap(review()));
    renderApp({ path: '/attempts/att-1/review' });
    await screen.findByRole('slider', { name: 'Speed, km/h' });
    expect(document.querySelectorAll('.track-map [data-segment="attempt"]')).toHaveLength(2);
    expect(document.querySelectorAll('[data-chart="speed"] [data-series="you"]')).toHaveLength(2);
    expect(document.querySelectorAll('[data-chart="speed"] [data-series="ref"]')).toHaveLength(1);
  });

  it('review_can_switch_reference', async () => {
    setViewportWidth(1280);
    reviewApi();
    renderApp({ path: '/attempts/att-1/review' });
    const select = await screen.findByRole('combobox', { name: 'Compare with' });
    await screen.findByRole('option', { name: /Your attempt/ });
    expect(requestedReferences).toEqual([null]);
    await userEvent.setup().selectOptions(select, 'ref-attempt');
    await waitFor(() => expect(requestedReferences).toEqual([null, 'ref-attempt']));
    expect(window.location.search).toBe('?reference=ref-attempt');
    expect(await screen.findByText(/No differences above the limits/)).toBeInTheDocument();
  });

  it('differences_heading_explains_difference_is_not_always_a_mistake', async () => {
    setViewportWidth(1280);
    reviewApi();
    renderApp({ path: '/attempts/att-1/review' });
    expect(await screen.findByRole('heading', { name: 'Differences from the reference' })).toBeInTheDocument();
    expect(screen.getByText(/A difference is not always a mistake/)).toBeInTheDocument();
  });

  it('phone_review_shows_map_and_differences_first', async () => {
    setViewportWidth(390);
    reviewApi();
    renderApp({ path: '/attempts/att-1/review' });
    const heading = await screen.findByRole('heading', { name: 'Differences from the reference' });
    const map = document.querySelector('.track-map')!;
    const speed = screen.getByRole('slider', { name: 'Speed, km/h' });
    expect(map.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(heading.compareDocumentPosition(speed) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('review_lists_corners_inside_or_outside', async () => {
    setViewportWidth(1280);
    const corners = [
      { number: 1, turnInSM: 461, apexSM: 519, radiusM: 43, apexSpeedKph: 89, outsideM: 4.84, speedKph: 84.2 },
      { number: 2, turnInSM: 691, apexSM: 737, radiusM: 66, apexSpeedKph: 110, outsideM: 0.4, speedKph: 111 },
      { number: 3, turnInSM: 834, apexSM: 870, radiusM: 84, apexSpeedKph: 123, outsideM: -1.26, speedKph: null },
      { number: 4, turnInSM: 900, apexSM: 950, radiusM: 84, apexSpeedKph: 123, outsideM: null, speedKph: null }
    ];
    reviewApi(review({ corners }));
    renderApp({ path: '/attempts/att-1/review' });
    const list = await screen.findByRole('region', { name: 'Corners' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('Turn 1');
    expect(rows[0]).toHaveTextContent('4.8 m outside');
    expect(rows[0]).toHaveTextContent('84 km/h at the apex, reference 89 km/h');
    expect(rows[1]).toHaveTextContent('on the line');
    expect(rows[2]).toHaveTextContent('1.3 m inside');
    expect(rows[2]).toHaveTextContent('no speed match at the apex');
    expect(rows[3]).toHaveTextContent('no match at the apex');
    expect(document.querySelectorAll('.track-map .track-mark.apex')).toHaveLength(4);
  });

  it('review_shows_brake_reaction_of_the_attempt', async () => {
    setViewportWidth(1280);
    reviewApi(review({ reactions: [{ eventKey: 'brake@10', reactionMs: 640 }] }));
    renderApp({ path: '/attempts/att-1/review' });
    const list = await screen.findByRole('region', { name: 'Brake reaction' });
    expect(list).toHaveTextContent('10 m: you started to brake 0.6 s after the cue');
  });

  it('review_without_voiced_brake_has_no_reaction_section', async () => {
    setViewportWidth(1280);
    reviewApi();
    renderApp({ path: '/attempts/att-1/review' });
    await screen.findByRole('heading', { name: 'Differences from the reference' });
    expect(screen.queryByRole('region', { name: 'Brake reaction' })).not.toBeInTheDocument();
  });
});

