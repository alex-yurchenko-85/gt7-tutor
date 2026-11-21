import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { RaceSummary } from '@gt7/contracts';
import { ApiStub, renderApp, sendLiveState, setViewportWidth, signedIn } from './support.tsx';

const PANORAMA_ID = 'a0000000-0000-4000-8000-000000000001';
const RING_ID = 'a0000000-0000-4000-8000-000000000002';
const OLDER_ID = 'a0000000-0000-4000-8000-000000000003';

function localIso(day: number, hour: number, minute: number): string {
  return new Date(2026, 10, day, hour, minute).toISOString();
}

function race(overrides: Partial<RaceSummary> = {}): RaceSummary {
  return {
    id: PANORAMA_ID,
    trackName: 'Mount Panorama',
    trackCandidates: ['Mount Panorama'],
    carId: 3437,
    carName: "BAC Mono '16",
    firstLap: 1,
    lapsDone: 7,
    lapsInRace: 7,
    cars: 20,
    startPosition: 20,
    finishPosition: 2,
    raceMs: 1_000_000,
    bestLap: 4,
    bestLapMs: 138_285,
    pitStops: 2,
    offTrack: 20,
    complete: true,
    startedAt: localIso(20, 17, 36),
    ...overrides
  };
}

const PANORAMA = race();
const RING = race({
  id: RING_ID,
  trackName: 'High Speed Ring',
  carName: 'Lexus RC F Gr.4',
  lapsDone: 5,
  lapsInRace: 5,
  cars: 10,
  startPosition: 10,
  finishPosition: 2,
  bestLapMs: 77_623,
  pitStops: 0,
  startedAt: localIso(20, 17, 21)
});
const OLDER = race({ id: OLDER_ID, trackName: 'Tsukuba Circuit', pitStops: 1, startedAt: localIso(18, 9, 5) });

function racesApi(races: RaceSummary[] = [PANORAMA, RING, OLDER]): ApiStub {
  return signedIn(new ApiStub()).on('GET /api/races', races).install();
}

function rowOf(name: string): HTMLElement {
  return screen.getByRole('link', { name: new RegExp(`^${name}`) });
}

describe('races list', () => {
  it('races_list_groups_rows_by_day_with_links', async () => {
    racesApi();
    renderApp({ path: '/races' });
    expect(await screen.findByRole('heading', { level: 1, name: 'Races' })).toBeVisible();
    expect(await screen.findByRole('heading', { level: 2, name: 'My races 3' })).toBeInTheDocument();
    const days = screen.getAllByRole('group').filter(group => group.getAttribute('aria-labelledby')?.startsWith('race-day-'));
    expect(days.map(day => within(day).getByRole('heading').textContent)).toEqual(['20 November', '18 November']);
    expect(within(days[0]!).getAllByRole('link').map(link => link.getAttribute('href'))).toEqual([`/races/${PANORAMA_ID}`, `/races/${RING_ID}`]);
    const panorama = rowOf('Mount Panorama');
    expect(panorama).toHaveTextContent("BAC Mono '16 · 7 laps · 2 pit stops · 17:36");
    expect(panorama).toHaveTextContent('20 → 2position');
    expect(panorama).toHaveTextContent('2:18.285best lap');
    expect(rowOf('High Speed Ring')).toHaveTextContent('Lexus RC F Gr.4 · 5 laps · 17:21');
    expect(rowOf('Tsukuba Circuit')).toHaveTextContent("BAC Mono '16 · 7 laps · 1 pit stop · 09:05");
    expect(screen.getByRole('button', { name: 'Select' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Record a race' })).toHaveTextContent('Record a race');
  });

  it('races_phone_row_shows_best_lap_then_position', async () => {
    setViewportWidth(390);
    racesApi();
    renderApp({ path: '/races' });
    const panorama = await screen.findByRole('link', { name: /^Mount Panorama/ });
    expect(panorama).toHaveTextContent("BAC Mono '16 · 7 laps · 2 pit stops2:18.285position 20 → 2");
    expect(panorama).not.toHaveTextContent('17:36');
    expect(screen.getByRole('heading', { level: 1, name: 'Races' })).toHaveClass('visually-hidden');
    expect(screen.getByRole('button', { name: 'Record a race' })).toHaveTextContent(/^Record$/);
  });

  it('race_without_a_track_name_and_without_a_car_name', async () => {
    racesApi([race({ trackName: null, carName: null, pitStops: 0 })]);
    renderApp({ path: '/races' });
    const row = await screen.findByRole('link', { name: /^Race without a track name/ });
    expect(row).toHaveTextContent(/^Race without a track name7 laps · 17:36/);
  });

  it('race_that_is_not_finished_says_which_laps_it_has', async () => {
    racesApi([
      race({ complete: false, lapsDone: 3, pitStops: 0 }),
      race({ id: RING_ID, trackName: 'High Speed Ring', complete: false, firstLap: 5, lapsDone: 3, pitStops: 0, startedAt: localIso(20, 17, 21) })
    ]);
    renderApp({ path: '/races' });
    expect(await screen.findByRole('link', { name: /^Mount Panorama/ })).toHaveTextContent("BAC Mono '16 · 3 of 7 laps, not finished · 17:36");
    expect(rowOf('High Speed Ring')).toHaveTextContent("BAC Mono '16 · laps 5 to 7 of 7, not finished · 17:21");
  });

  it('races_empty_state_says_how_to_record', async () => {
    racesApi([]);
    renderApp({ path: '/races' });
    expect(await screen.findByText('No races yet.')).toBeInTheDocument();
    expect(screen.getByText('Select Record a race, then start a race by laps in the game. The recording starts and stops with the race.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'My races 0' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Select' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Record a race' })).toBeEnabled();
  });

  it('races_empty_state_names_the_short_button_on_a_phone', async () => {
    setViewportWidth(390);
    racesApi([]);
    renderApp({ path: '/races' });
    expect(await screen.findByText('Select Record, then start a race by laps in the game. The recording starts and stops with the race.')).toBeInTheDocument();
  });

  it('races_read_error_is_shown', async () => {
    signedIn(new ApiStub()).on('GET /api/races', { status: 500, body: { reason: 'The database does not answer.' } }).install();
    renderApp({ path: '/races' });
    expect(await screen.findByText('The database does not answer.')).toBeInTheDocument();
  });

  it('record_a_race_starts_the_recording_and_opens_its_screen', async () => {
    const api = racesApi().on('POST /api/races/record', { captureId: 'c1' });
    renderApp({ path: '/races' });
    await userEvent.click(await screen.findByRole('button', { name: 'Record a race' }));
    await waitFor(() => expect(window.location.pathname).toBe('/races/record'));
    expect(api.called('POST /api/races/record')).toBe(true);
  });

  it('record_a_race_says_what_to_do_when_another_recording_runs', async () => {
    racesApi().on('POST /api/races/record', { status: 409, body: { code: 'busy', reason: 'A capture or training is already active.' } });
    renderApp({ path: '/races' });
    await userEvent.click(await screen.findByRole('button', { name: 'Record a race' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/^A recording or a training runs\. Stop it first\.$/);
    expect(window.location.pathname).toBe('/races');
  });

  it('record_a_race_shows_the_reason_of_another_error', async () => {
    racesApi().on('POST /api/races/record', { status: 503, body: { code: 'shutting-down', reason: 'The server is stopping.' } });
    renderApp({ path: '/races' });
    await userEvent.click(await screen.findByRole('button', { name: 'Record a race' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The server is stopping.');
  });

  it.each(['race-waiting', 'race-running'] as const)('record_button_reads_recording_in_%s', async mode => {
    racesApi();
    const view = renderApp({ path: '/races' });
    await sendLiveState(view, { mode, race: null });
    const button = await screen.findByRole('button', { name: 'Recording…' });
    expect(button).toBeDisabled();
  });

  it('list_loads_again_when_a_race_is_stored', async () => {
    const api = racesApi([RING]);
    const view = renderApp({ path: '/races' });
    await sendLiveState(view, { mode: 'idle', lastRaceId: null });
    expect(await screen.findByRole('heading', { level: 2, name: 'My races 1' })).toBeInTheDocument();
    api.on('GET /api/races', [PANORAMA, RING]);
    await sendLiveState(view, { mode: 'idle', lastRaceId: PANORAMA_ID, seq: 2 });
    expect(await screen.findByRole('heading', { level: 2, name: 'My races 2' })).toBeInTheDocument();
  });

  it('select_and_delete_races_with_the_dialog', async () => {
    const api = racesApi().on('POST /api/races/delete', { deleted: 2 });
    renderApp({ path: '/races' });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Select' }));
    expect(screen.queryByRole('link', { name: /^Mount Panorama/ })).not.toBeInTheDocument();
    const bar = screen.getByRole('region', { name: 'Selection' });
    expect(within(bar).getByRole('button', { name: 'Delete 0 races' })).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: 'Select Mount Panorama' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select High Speed Ring' }));
    expect(bar).toHaveTextContent('2 selected');
    await user.click(within(bar).getByRole('button', { name: 'Delete 2 races' }));
    let dialog = screen.getByRole('alertdialog', { name: 'Delete 2 races?' });
    expect(dialog).toHaveTextContent('The laps, the pit stops and the places off the track of these races go. Clean up captures frees the disk space later.');
    await user.click(within(dialog).getByRole('button', { name: 'Keep races' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(api.called('POST /api/races/delete')).toBe(false);
    expect(screen.getByRole('checkbox', { name: 'Select Mount Panorama' })).toBeChecked();
    api.on('GET /api/races', [OLDER]);
    await user.click(within(bar).getByRole('button', { name: 'Delete 2 races' }));
    dialog = screen.getByRole('alertdialog', { name: 'Delete 2 races?' });
    await user.click(within(dialog).getByRole('button', { name: 'Delete races' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(api.calls.find(call => call.path === '/api/races/delete')!.body).toEqual({ ids: [PANORAMA_ID, RING_ID] });
    expect(await screen.findByRole('heading', { level: 2, name: 'My races 1' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Selection' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^Tsukuba Circuit/ })).toBeInTheDocument();
  });

  it('delete_one_race_names_it_in_the_singular', async () => {
    racesApi();
    renderApp({ path: '/races' });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Select' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select High Speed Ring' }));
    await user.click(screen.getByRole('button', { name: 'Delete 1 race' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Delete 1 race?' });
    expect(dialog).toHaveTextContent('The laps, the pit stops and the places off the track of this race go. Clean up captures frees the disk space later.');
    expect(within(dialog).getByRole('button', { name: 'Delete race' })).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Keep race' }));
    expect(screen.getByRole('button', { name: 'Delete 1 race' })).toHaveFocus();
  });

  it('delete_error_stays_in_the_dialog', async () => {
    racesApi().on('POST /api/races/delete', { status: 404, body: { message: 'Race not found' } });
    renderApp({ path: '/races' });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Select' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select Tsukuba Circuit' }));
    await user.click(screen.getByRole('button', { name: 'Delete 1 race' }));
    const dialog = screen.getByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Delete race' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Race not found');
    expect(within(dialog).getByRole('button', { name: 'Delete race' })).toBeEnabled();
  });

  it('cancel_selection_brings_the_links_back', async () => {
    racesApi();
    renderApp({ path: '/races' });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Select' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select Mount Panorama' }));
    await user.click(within(screen.getByRole('region', { name: 'Selection' })).getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('link', { name: /^Mount Panorama/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Select' }));
    expect(screen.getByRole('checkbox', { name: 'Select Mount Panorama' })).not.toBeChecked();
  });

  it('race_page_route_shows_not_found_for_a_bad_id', async () => {
    racesApi();
    renderApp({ path: '/races/not-a-uuid' });
    expect(await screen.findByRole('heading', { level: 1, name: 'This page does not exist' })).toBeInTheDocument();
  });
});
