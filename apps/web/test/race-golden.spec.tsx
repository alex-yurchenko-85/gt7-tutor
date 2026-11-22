import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { RaceDetail, RaceGoldenLap, RaceGoldenSector, RaceLapsSpeed } from '@gt7/contracts';
import { parseRoute, paths } from '../src/app/router.tsx';
import { PANORAMA_LAPS, RACE_ID, raceDetail } from './race-fixtures.ts';
import { ApiStub, renderApp, setViewportWidth, signedIn, el, findEl } from './support.tsx';

const GOLDEN_PATH = `/api/races/${RACE_ID}/golden`;
const GRID_M = 2;
const LENGTH_M = 3344;

type SectorRow = [number, number, number, number, number, number, number, number, number];

const INFIELD_SECTORS: SectorRow[] = [
  [1, 0, 1068, 3, 18_023, 4, 17_951, 17_987, 2],
  [2, 1068, 1369, 3, 9_039, 3, 9_039, 9_123, 3],
  [3, 1369, 1956, 4, 15_479, 4, 15_479, 16_096, 3],
  [4, 1956, 2205, 4, 6_694, 2, 6_269, 6_349, 3],
  [5, 2205, 2306, 3, 2_387, 4, 2_220, 2_387, 3],
  [6, 2306, 2586, 3, 6_548, 3, 6_548, 6_771, 3],
  [7, 2586, 2749, 3, 3_535, 2, 3_340, 3_535, 3],
  [8, 2749, 3344, 4, 11_620, 4, 11_620, 11_743, 3]
];

function sectorOf([turn, fromM, toM, lap, ms, bestLap, bestMs, medianMs, cleanLaps]: SectorRow): RaceGoldenSector {
  return { turn, fromM, toM, lap, ms, bestLap, bestMs, medianMs, spreadMs: medianMs - bestMs, cleanLaps, bestJoins: lap === bestLap, slipstream: false };
}

function line() {
  const count = LENGTH_M / GRID_M + 1;
  const angle = (index: number) => (2 * Math.PI * index) / (count - 1);
  return { gridM: GRID_M, x: Array.from({ length: count }, (_, index) => 500 * Math.sin(angle(index))), z: Array.from({ length: count }, (_, index) => 300 * Math.cos(angle(index))) };
}

function infieldGolden(): RaceGoldenLap {
  return { state: 'ok', bestLap: 3, bestMs: 74_120, goldenMs: 73_325.095, sourceLaps: [3, 4], cleanLaps: [2, 3, 4], sectors: INFIELD_SECTORS.map(sectorOf), line: line() };
}

function infieldDetail(): RaceDetail {
  const times = [78_218, 76_173, 74_120, 74_137];
  return raceDetail({
    trackName: 'Blue Moon Bay Speedway - Infield A Reverse',
    carName: "Maserati MC20 '20",
    lapsDone: 4,
    lapsInRace: 4,
    bestLap: 3,
    bestLapMs: 74_120,
    referenceLap: 3,
    pitStops: 0,
    pitStopList: [],
    offTrack: 1,
    lapLengthM: LENGTH_M,
    offTrackList: [{ lap: 2, sM: 1027, x: 0, z: 0, wheels: 4, durationMs: 900, speedInMps: 40, speedMinMps: 20 }],
    laps: times.map((timeMs, index) => ({ ...PANORAMA_LAPS[0]!, number: index + 1, timeMs, pitIn: false, pitOut: false, closed: index > 0 }))
  });
}

function speedView(): RaceLapsSpeed {
  return { gridM: GRID_M, lengthM: LENGTH_M, turns: INFIELD_SECTORS.map(([turn, fromM, toM]) => ({ turn, fromSM: fromM + 20, toSM: Math.min(toM, fromM + 80) })), laps: [] };
}

async function openGolden(golden: RaceGoldenLap = infieldGolden(), detail: RaceDetail = infieldDetail()) {
  const api = signedIn(new ApiStub()).on(`GET /api/races/${RACE_ID}`, detail).on(`GET ${GOLDEN_PATH}`, golden).on(`GET /api/races/${RACE_ID}/speed`, speedView()).install();
  renderApp({ path: `/races/${RACE_ID}/golden` });
  await waitFor(() => {
    if (!document.querySelector('.race-golden-tab')) throw new Error('The tab is not drawn yet');
  });
  return api;
}

async function turnRows(): Promise<string[]> {
  const table = await findEl('.golden-table');
  return within(table)
    .getAllByRole('row')
    .slice(1)
    .map(row => within(row).getAllByRole('cell')[0]!.textContent ?? '');
}

describe('race page, golden lap tab', () => {
  it('shows_the_best_lap_the_golden_lap_and_the_gain', async () => {
    await openGolden();
    const band = await findEl('.race-golden-band');
    expect(within(band).getByText('1:14.120')).toBeInTheDocument();
    expect(within(band).getByText('best clean lap · lap 3')).toBeInTheDocument();
    expect(within(band).getByText('1:13.325')).toBeInTheDocument();
    expect(within(band).getByText('golden lap · from laps 3 and 4')).toBeInTheDocument();
    expect(within(band).getByText('−0.795 s')).toBeInTheDocument();
    expect(within(band).getByText('possible gain')).toBeInTheDocument();
    expect(within(band).getByText(/clean laps 2 to 4/)).toBeInTheDocument();
    expect(screen.getByText(/at each join the speed differs by 5 km\/h at most and the line by 1\.5 m at most/)).toBeInTheDocument();
    expect(screen.queryByText(/from the game/i)).toBeNull();
  });

  it('reverses_the_sort_on_a_second_click_of_the_active_header', async () => {
    await openGolden();
    expect(await turnRows()).toEqual(['T3', 'T6', 'T7', 'T5', 'T8', 'T2', 'T4', 'T1']);
    const user = userEvent.setup();
    const header = (name: string) => screen.getByRole('button', { name }).closest('[role="columnheader"]')!;
    await user.click(screen.getByRole('button', { name: 'Spread, best to median' }));
    expect(await turnRows()).toEqual(['T1', 'T4', 'T2', 'T8', 'T5', 'T7', 'T6', 'T3']);
    expect(header('Spread, best to median')).toHaveAttribute('aria-sort', 'ascending');
    expect(header('Spread, best to median').querySelector('[data-arrow="ascending"]')).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Turn' }));
    expect(await turnRows()).toEqual(['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8']);
    expect(header('Turn')).toHaveAttribute('aria-sort', 'ascending');
    await user.click(screen.getByRole('button', { name: 'Turn' }));
    expect(await turnRows()).toEqual(['T8', 'T7', 'T6', 'T5', 'T4', 'T3', 'T2', 'T1']);
    expect(header('Turn')).toHaveAttribute('aria-sort', 'descending');
    expect(header('Turn').querySelector('[data-arrow="descending"]')).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Spread, best to median' }));
    expect(await turnRows()).toEqual(['T3', 'T6', 'T7', 'T5', 'T8', 'T2', 'T4', 'T1']);
    expect(header('Spread, best to median')).toHaveAttribute('aria-sort', 'descending');
    expect(header('Turn')).not.toHaveAttribute('aria-sort');
  });

  it('sorts_by_spread_first_and_by_turn_on_a_click', async () => {
    await openGolden();
    expect(await turnRows()).toEqual(['T3', 'T6', 'T7', 'T5', 'T8', 'T2', 'T4', 'T1']);
    const spread = screen.getByRole('button', { name: 'Spread, best to median' }).closest('[role="columnheader"]')!;
    expect(spread).toHaveAttribute('aria-sort', 'descending');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Turn' }));
    expect(await turnRows()).toEqual(['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8']);
    expect(screen.getByRole('button', { name: 'Turn' }).closest('[role="columnheader"]')).toHaveAttribute('aria-sort', 'ascending');
    expect(spread).not.toHaveAttribute('aria-sort');
    const first = within(el('.golden-table')).getAllByRole('row')[1]!;
    expect(first).toHaveTextContent('0–1,068 m');
    expect(first).toHaveTextContent('18.023');
    expect(first).toHaveTextContent('17.951');
    expect(first).toHaveTextContent('17.987');
    expect(first).toHaveTextContent('0.036 s');
  });

  it('marks_a_best_sector_that_does_not_join', async () => {
    await openGolden();
    expect(await screen.findByText('Best 3.340 (lap 2) does not fit')).toBeInTheDocument();
    expect(screen.getByText('Best 6.269 (lap 2) does not fit')).toBeInTheDocument();
    expect(screen.queryByText(/Best 15\.479/)).toBeNull();
  });

  it('marks_a_sector_with_fewer_clean_laps', async () => {
    await openGolden();
    expect(await screen.findByText('Lap 2 off track here')).toBeInTheDocument();
    expect(screen.getAllByText(/off track here/)).toHaveLength(1);
  });

  it('names_several_laps_off_track_in_one_sector', async () => {
    const detail = infieldDetail();
    const golden = infieldGolden() as Extract<RaceGoldenLap, { state: 'ok' }>;
    const moment = detail.offTrackList[0]!;
    await openGolden(
      { ...golden, sectors: golden.sectors.map(sector => (sector.turn === 1 ? { ...sector, cleanLaps: 1 } : sector)) },
      { ...detail, offTrack: 2, offTrackList: [moment, { ...moment, lap: 4, sM: 500 }] }
    );
    expect(await screen.findByText('Laps 2 and 4 off track here')).toBeInTheDocument();
  });

  it('keeps_three_columns_on_a_phone', async () => {
    setViewportWidth(390);
    await openGolden();
    const table = await findEl('.golden-table');
    expect(within(table).getAllByRole('columnheader').map(cell => cell.textContent)).toEqual(['Turn', 'Golden lap', 'Spread']);
    expect(screen.getByText('golden lap')).toBeInTheDocument();
    expect(screen.getByText(/^From laps 3 and 4\./)).toBeInTheDocument();
  });

  it('draws_the_line_in_the_colour_of_each_source_lap', async () => {
    await openGolden();
    const map = await findEl('.race-golden-tab .track-map');
    const parts = [...map.querySelectorAll('.track-segment')].map(part => part.getAttribute('data-colour'));
    expect(parts).toEqual(['a', 'a', 'b', 'b', 'a', 'a', 'a', 'b']);
    expect(map.querySelectorAll('.track-mark.join')).toHaveLength(7);
    const legend = document.querySelector<HTMLElement>('.race-golden-map .map-legend')!;
    expect([...legend.querySelectorAll('span')].map(item => item.textContent)).toEqual(['from lap 3', 'from lap 4', 'join']);
  });

  it('tells_five_source_laps_apart', async () => {
    const golden = infieldGolden() as Extract<RaceGoldenLap, { state: 'ok' }>;
    const laps = [2, 3, 4, 5, 6, 2, 3, 4];
    await openGolden({ ...golden, sourceLaps: [2, 3, 4, 5, 6], cleanLaps: [2, 3, 4, 5, 6], sectors: golden.sectors.map((sector, index) => ({ ...sector, lap: laps[index]! })) });
    const legend = await waitFor(() => {
      const found = document.querySelector<HTMLElement>('.race-golden-map .map-legend');
      if (!found) throw new Error('No legend yet');
      return found;
    });
    const looks = [...legend.querySelectorAll('i.lap-swatch')].map(swatch => swatch.className);
    expect(looks).toHaveLength(5);
    expect(new Set(looks).size).toBe(5);
    const parts = [...document.querySelectorAll('.track-segment')].map(part => `${part.getAttribute('data-colour')}${part.getAttribute('data-dashed') ?? ''}`);
    expect(parts[0]).not.toBe(parts[4]);
  });

  it('explains_why_there_is_no_golden_lap', async () => {
    const panorama = raceDetail();
    const empty = { gridM: GRID_M, x: [], z: [] };
    const excluded = [
      { lap: 1, reason: 'first' as const },
      { lap: 2, reason: 'pit' as const },
      { lap: 3, reason: 'pit' as const },
      { lap: 5, reason: 'pit' as const },
      { lap: 6, reason: 'pit' as const }
    ];
    await openGolden({ state: 'too-few', cleanLaps: [4, 7], excluded, line: empty }, panorama);
    expect(await screen.findByRole('heading', { name: 'No golden lap for this race' })).toBeInTheDocument();
    expect(screen.getByText('A golden lap needs 3 clean laps. This race has 2: laps 4 and 7.')).toBeInTheDocument();
    expect(screen.getByText('Lap 1 is the first lap of the race and does not count.')).toBeInTheDocument();
    expect(screen.getByText('Laps 2, 3, 5 and 6 have a pit stop and do not count.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('names_the_first_recorded_lap', async () => {
    await openGolden({ state: 'too-few', cleanLaps: [6, 7], excluded: [{ lap: 5, reason: 'first' }], line: line() }, raceDetail({ firstLap: 5, complete: false, lapsDone: 3 }));
    expect(await screen.findByText('Lap 5 is the first recorded lap and does not count.')).toBeInTheDocument();
  });

  it('counts_a_moment_at_the_lap_line_in_the_last_sector', async () => {
    const detail = infieldDetail();
    const golden = infieldGolden() as Extract<RaceGoldenLap, { state: 'ok' }>;
    await openGolden(
      { ...golden, sectors: golden.sectors.map(sector => (sector.turn === 8 ? { ...sector, cleanLaps: 2 } : sector)) },
      { ...detail, offTrack: 2, offTrackList: [...detail.offTrackList, { ...detail.offTrackList[0]!, lap: 3, sM: LENGTH_M }] }
    );
    expect(await screen.findByText('Lap 3 off track here')).toBeInTheDocument();
  });

  it('explains_a_turn_without_a_clean_lap', async () => {
    await openGolden({ state: 'gap', cleanLaps: [2, 3, 4], turn: 5, line: line() });
    expect(await screen.findByRole('heading', { name: 'No golden lap for this race' })).toBeInTheDocument();
    expect(screen.getByText('Each clean lap left the track in turn 5, so no clean lap gives a time for that turn.')).toBeInTheDocument();
  });

  it('explains_parts_that_do_not_fit_together', async () => {
    await openGolden({ state: 'no-chain', cleanLaps: [2, 3, 4], line: line() });
    expect(await screen.findByRole('heading', { name: 'No golden lap for this race' })).toBeInTheDocument();
    expect(screen.getByText('Each clean lap left the track in one turn or more, and the other parts do not fit together at the joins.')).toBeInTheDocument();
  });

  it('opens_the_golden_tab_from_its_address', async () => {
    expect(parseRoute(`/races/${RACE_ID}/golden`)).toEqual({ name: 'race', raceId: RACE_ID, tab: 'golden' });
    expect(paths.race(RACE_ID, 'golden')).toBe(`/races/${RACE_ID}/golden`);
    await openGolden();
    expect(within(el('nav.exercise-tabs')).getByRole('link', { name: 'Golden lap' })).toHaveAttribute('aria-current', 'page');
  });
});
