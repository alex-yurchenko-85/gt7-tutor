import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { LiveRace } from '@gt7/contracts';
import { ApiStub, renderApp, sendLiveState, setViewportWidth, signedIn } from './support.tsx';

const RACE_ID = 'a0000000-0000-4000-8000-000000000001';

function liveRace(overrides: Partial<LiveRace> = {}): LiveRace {
  return {
    phase: 'lap',
    unsupported: false,
    lap: 3,
    lapsInRace: 7,
    firstRecordedLap: 1,
    position: 11,
    startPosition: 20,
    cars: 20,
    lapTimeMs: 47_349,
    lastLapMs: 157_850,
    bestLap: 1,
    bestLapMs: 142_032,
    laps: [
      { number: 1, timeMs: 142_032, pitAfter: false },
      { number: 2, timeMs: 157_850, pitAfter: true }
    ],
    fuel: 91.2,
    fuelLapsLeft: 3.04,
    x: 10,
    z: 20,
    carName: "BAC Mono '16",
    savedRaceId: null,
    ...overrides
  };
}

const WAITING = liveRace({ phase: 'waiting', lap: 0, lapsInRace: 0, firstRecordedLap: null, position: -1, startPosition: null, cars: -1, lapTimeMs: 0, lastLapMs: null, bestLap: null, bestLapMs: null, laps: [], carName: null });

function stageApi(): ApiStub {
  return signedIn(new ApiStub())
    .on('GET /api/races', [])
    .on('POST /api/races/record/stop', { raceId: null })
    .on('POST /api/races/record/close', { ok: true })
    .install();
}

async function openStage(race: LiveRace | null, mode: 'race-waiting' | 'race-running' | 'idle' = race?.phase === 'waiting' ? 'race-waiting' : 'race-running') {
  const view = renderApp({ path: '/races/record' });
  await sendLiveState(view, { mode, race });
  return view;
}

function stats(): string[] {
  return [...document.querySelectorAll('.race-stat')].map(stat => stat.textContent ?? '');
}

function circles(): string[] {
  return within(screen.getByRole('list', { name: 'Laps' }))
    .getAllByRole('listitem')
    .map(item => item.getAttribute('aria-label') ?? '');
}

function key(): string[] {
  return within(screen.getByRole('list', { name: 'What the circles mean' }))
    .getAllByRole('listitem')
    .map(item => item.textContent ?? '');
}

function noStrip() {
  expect(document.querySelector('.race-strip, .race-seg, .race-flag')).toBeNull();
}

describe('race recording stage', () => {
  it('waiting_shows_what_to_do_without_position_and_without_lights', async () => {
    const api = stageApi();
    await openStage(WAITING);
    expect(await screen.findByRole('heading', { level: 1, name: 'WAITING' })).toBeInTheDocument();
    expect(screen.queryByRole('banner')).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument();
    expect(screen.getByText('Race recording')).toBeInTheDocument();
    expect(screen.getByText('Start a race of 2 or more laps in the game.')).toBeInTheDocument();
    expect(screen.getByText('The recording starts with the race and stops at the finish. You can look at the TV now.')).toBeInTheDocument();
    expect(document.querySelector('.race-light, .race-lights')).toBeNull();
    expect(document.body.textContent).not.toMatch(/-1/);
    expect(screen.queryByRole('list', { name: 'Laps' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(window.location.pathname).toBe('/races'));
    expect(api.called('POST /api/races/record/stop')).toBe(true);
  });

  it('waiting_says_when_the_session_is_not_a_race_by_laps', async () => {
    stageApi();
    await openStage({ ...WAITING, unsupported: true });
    expect(await screen.findByText('This is not a race of 2 or more laps. Only a race by laps can be recorded.')).toBeInTheDocument();
    expect(screen.queryByText('Start a race of 2 or more laps in the game.')).not.toBeInTheDocument();
  });

  it('grid_shows_lap_1_at_once_with_the_start_position', async () => {
    const api = stageApi();
    await openStage(liveRace({ phase: 'grid', lap: 0, position: 20, laps: [], lastLapMs: null, bestLap: null, bestLapMs: null, lapTimeMs: 0, fuel: 100, fuelLapsLeft: null }));
    const word = await screen.findByRole('heading', { level: 1, name: 'LAP 1 of 7' });
    expect(word).not.toHaveClass('dim');
    expect(screen.queryByText('ON THE GRID')).not.toBeInTheDocument();
    expect(document.querySelector('.race-light, .race-lights')).toBeNull();
    expect(screen.getByText("BAC Mono '16")).toBeInTheDocument();
    expect(stats()).toEqual(['0:00.0this lap', 'P 20of 20', '\u2013last lap', '\u2013best lap', '100fuel']);
    expect(circles()).toEqual(['Lap 1, this lap', 'Lap 2, to come', 'Lap 3, to come', 'Lap 4, to come', 'Lap 5, to come', 'Lap 6, to come', 'Lap 7, to come']);
    expect(screen.getByRole('img', { name: 'The line of the last lap, brightest at the car' })).toBeInTheDocument();
    await waitFor(() => expect(Number(document.querySelector('.race-trail-car')!.getAttribute('r'))).toBeGreaterThan(0));
    expect(document.querySelectorAll('.race-trail-line')).toHaveLength(0);
    noStrip();
    await userEvent.click(screen.getByRole('button', { name: 'Stop recording' }));
    await waitFor(() => expect(api.called('POST /api/races/record/stop')).toBe(true));
    expect(window.location.pathname).toBe('/races/record');
  });

  it('grid_shows_no_fuel_before_the_first_reading', async () => {
    stageApi();
    await openStage(liveRace({ phase: 'grid', lap: 0, laps: [], lastLapMs: null, bestLap: null, bestLapMs: null, lapTimeMs: 0, fuel: 0 }));
    await screen.findByRole('heading', { level: 1, name: 'LAP 1 of 7' });
    expect(stats().some(text => text.endsWith('fuel'))).toBe(false);
  });

  it('grid_shows_no_position_below_1', async () => {
    stageApi();
    await openStage(liveRace({ phase: 'grid', lap: 0, position: -1, cars: -1, laps: [], lastLapMs: null, bestLap: null, bestLapMs: null, lapTimeMs: 0 }));
    await screen.findByRole('heading', { level: 1, name: 'LAP 1 of 7' });
    expect(stats()).toEqual(['0:00.0this lap', '\u2013last lap', '\u2013best lap', '91fuel']);
    expect(document.body.textContent).not.toMatch(/-1/);
  });

  it('lap_shows_no_position_below_1', async () => {
    stageApi();
    await openStage(liveRace({ position: 0, cars: 0 }));
    await screen.findByRole('heading', { level: 1, name: 'LAP 3 of 7' });
    expect(stats()).toEqual(['0:47.3this lap', '2:37.850last lap', '2:22.032best lap · lap 1', '91fuel · about 3.0 laps left']);
  });

  it('lap_shows_the_position_without_cars_when_the_cars_are_unknown', async () => {
    stageApi();
    await openStage(liveRace({ cars: -1 }));
    await screen.findByRole('heading', { level: 1, name: 'LAP 3 of 7' });
    expect(stats()).toContain('P 11position');
  });

  it('joined_shows_the_lap_that_runs_and_hatches_the_laps_before', async () => {
    stageApi();
    await openStage(liveRace({ phase: 'joined', lap: 4, firstRecordedLap: 5, position: 4, startPosition: null, lapTimeMs: 72_640, laps: [], lastLapMs: null, bestLap: null, bestLapMs: null }));
    const word = await screen.findByRole('heading', { level: 1, name: 'LAP 4 of 7' });
    expect(word).toHaveClass('dim');
    expect(screen.getByText('The race runs already')).toBeInTheDocument();
    expect(screen.getByText('The recording starts at the next lap line.')).toBeInTheDocument();
    expect(stats()).toEqual(['1:12.6this lap', 'P 4of 20']);
    expect(circles()).toEqual(['Lap 1, not recorded', 'Lap 2, not recorded', 'Lap 3, not recorded', 'Lap 4, not recorded', 'Lap 5, to come', 'Lap 6, to come', 'Lap 7, to come']);
    expect(key()).toEqual(['lap not recorded', 'lap to come']);
    noStrip();
    expect(screen.getByRole('img', { name: 'The line of the last lap, brightest at the car' })).toBeInTheDocument();
  });

  it('lap_shows_the_values_the_fuel_and_the_circles', async () => {
    stageApi();
    await openStage(liveRace());
    const word = await screen.findByRole('heading', { level: 1, name: 'LAP 3 of 7' });
    expect(word).not.toHaveClass('dim');
    expect(document.querySelector('.race-kicker')).toBeNull();
    expect(screen.getAllByText('Recording')).toHaveLength(1);
    expect(stats()).toEqual(['0:47.3this lap', 'P 11of 20', '2:37.850last lap', '2:22.032best lap · lap 1', '91fuel · about 3.0 laps left']);
    expect(document.querySelector('.race-fuel-bar')).not.toBeNull();
    expect(circles()).toEqual(['Lap 1, done, best lap', 'Lap 2, done', 'Pit stop after lap 2', 'Lap 3, this lap', 'Lap 4, to come', 'Lap 5, to come', 'Lap 6, to come', 'Lap 7, to come']);
    expect(key()).toEqual(['lap done', 'this lap', 'lap to come', 'best lap', 'pit stop after this lap']);
    const values = document.querySelector('.race-values')!;
    expect(values.querySelector('.race-stats')).not.toBeNull();
    expect(values.querySelector('.race-fuel')).not.toBeNull();
    expect(values.querySelector('.lap-circles')).not.toBeNull();
    expect(values.querySelector('.race-trail')).toBeNull();
    expect(document.querySelector('.race-stage-map')!.parentElement).toHaveClass('race-stage');
    noStrip();
    expect(screen.getByRole('img', { name: 'The line of the last lap, brightest at the car' })).toBeInTheDocument();
  });

  it('lap_without_an_estimate_says_only_fuel', async () => {
    stageApi();
    await openStage(liveRace({ lap: 1, laps: [], lastLapMs: null, bestLap: null, bestLapMs: null, fuelLapsLeft: null }));
    await screen.findByRole('heading', { level: 1, name: 'LAP 1 of 7' });
    expect(stats()).toEqual(['0:47.3this lap', 'P 11of 20', '91fuel']);
  });

  it('phone_puts_the_map_between_the_values_and_the_circles_and_has_no_fuel_bar', async () => {
    setViewportWidth(390);
    stageApi();
    await openStage(liveRace());
    await screen.findByRole('heading', { level: 1, name: 'LAP 3 of 7' });
    const values = document.querySelector('.race-values')!;
    const map = document.querySelector('.race-stage-map')!;
    const circles = document.querySelector('.lap-circles')!;
    expect(map.parentElement).toHaveClass('race-stage');
    expect(values.querySelector('.lap-circles')).toBeNull();
    expect(values.compareDocumentPosition(map) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(map.compareDocumentPosition(circles) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(circles.nextElementSibling).toHaveClass('lap-key');
    expect(stats()).toContain('91fuel · about 3.0 laps left');
    expect(document.querySelector('.race-fuel-bar')).toBeNull();
    noStrip();
  });

  it('finished_opens_the_race_by_itself_after_the_bar', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const api = stageApi();
    await openStage(liveRace({ phase: 'finished', lap: 8, position: 2, savedRaceId: RACE_ID, laps: [1, 2, 3, 4, 5, 6, 7].map(number => ({ number, timeMs: 140_000 + number, pitAfter: false })), bestLap: 1, bestLapMs: 140_001 }), 'idle');
    expect(await screen.findByRole('heading', { level: 1, name: 'P 2 of 20' })).toHaveClass('yellow');
    expect(screen.getByText('FINISHED')).toHaveClass('race-finished');
    expect(screen.getByText('You started in position 20. The race is in your list.')).toBeInTheDocument();
    expect(stats()).toEqual(['16:20.028race time', '2:20.001best lap · lap 1']);
    expect(screen.getByText('It opens by itself in a moment.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Laps' })).not.toBeInTheDocument();
    noStrip();
    act(() => {
      vi.advanceTimersByTime(2300);
    });
    expect(api.called('POST /api/races/record/close')).toBe(false);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    await waitFor(() => expect(window.location.pathname).toBe(`/races/${RACE_ID}`));
    expect(api.called('POST /api/races/record/close')).toBe(true);
  });

  it('finished_after_a_join_says_only_that_the_race_is_in_the_list', async () => {
    stageApi();
    await openStage(liveRace({ phase: 'finished', lap: 8, firstRecordedLap: 5, startPosition: 9, position: 2, savedRaceId: RACE_ID, laps: [5, 6, 7].map(number => ({ number, timeMs: 140_000, pitAfter: false })), bestLap: 5, bestLapMs: 140_000 }), 'idle');
    await screen.findByRole('heading', { level: 1, name: 'P 2 of 20' });
    expect(screen.getByText('The race is in your list.')).toBeInTheDocument();
    expect(screen.queryByText(/You started/)).not.toBeInTheDocument();
    expect(stats()).toEqual(['7:00.000time of the recorded laps', '2:20.000best lap · lap 5']);
  });

  it('finished_without_a_start_position_does_not_say_where_the_race_started', async () => {
    stageApi();
    await openStage(liveRace({ phase: 'finished', lap: 8, startPosition: null, position: 2, cars: -1, savedRaceId: RACE_ID }), 'idle');
    await screen.findByRole('heading', { level: 1, name: 'P 2' });
    expect(screen.getByText('The race is in your list.')).toBeInTheDocument();
  });

  it('finished_without_a_known_position_keeps_the_word_finished', async () => {
    stageApi();
    await openStage(liveRace({ phase: 'finished', lap: 8, position: -1, savedRaceId: RACE_ID }), 'idle');
    expect(await screen.findByRole('heading', { level: 1, name: 'FINISHED' })).not.toHaveClass('yellow');
    expect(document.querySelector('.race-finished')).toBeNull();
    expect(screen.getByText('You started in position 20. The race is in your list.')).toBeInTheDocument();
  });

  it('open_the_race_closes_and_opens_it_at_once', async () => {
    const api = stageApi();
    await openStage(liveRace({ phase: 'finished', lap: 8, position: 2, savedRaceId: RACE_ID }), 'idle');
    await userEvent.click(await screen.findByRole('button', { name: 'Open the race' }));
    await waitFor(() => expect(window.location.pathname).toBe(`/races/${RACE_ID}`));
    expect(api.called('POST /api/races/record/close')).toBe(true);
  });

  it('stopped_with_a_saved_race_says_how_many_laps_are_in_the_list', async () => {
    const api = stageApi();
    await openStage(
      liveRace({ phase: 'stopped', position: 6, savedRaceId: RACE_ID, laps: [{ number: 1, timeMs: 142_032, pitAfter: false }, { number: 2, timeMs: 157_850, pitAfter: true }, { number: 3, timeMs: 139_931, pitAfter: false }], bestLap: 3, bestLapMs: 139_931 }),
      'idle'
    );
    expect(await screen.findByRole('heading', { level: 1, name: 'RECORDING STOPPED' })).toBeInTheDocument();
    expect(screen.getByText('3 of 7 laps are in your list. The race is marked as not finished.')).toBeInTheDocument();
    expect(stats()).toEqual(['7:19.813time of the recorded laps', '2:19.931best lap · lap 3', '20 → 6position, start to lap 3']);
    expect(screen.getByRole('button', { name: 'Open the race' })).toBeInTheDocument();
    expect(circles()).toEqual(['Lap 1, done', 'Lap 2, done', 'Pit stop after lap 2', 'Lap 3, done, best lap', 'Lap 4, to come', 'Lap 5, to come', 'Lap 6, to come', 'Lap 7, to come']);
    expect(key()).toEqual(['lap done', 'lap to come', 'best lap', 'pit stop after this lap']);
    noStrip();
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(window.location.pathname).toBe('/races'));
    expect(api.called('POST /api/races/record/close')).toBe(true);
  });

  it('stopped_without_a_saved_race_says_nothing_was_saved', async () => {
    const api = stageApi();
    await openStage(liveRace({ phase: 'stopped', lap: 1, laps: [], lastLapMs: null, bestLap: null, bestLapMs: null, savedRaceId: null }), 'idle');
    expect(await screen.findByText('No complete lap was recorded. Nothing was saved.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open the race' })).not.toBeInTheDocument();
    expect(stats()).toEqual([]);
    await userEvent.click(screen.getByRole('button', { name: 'Back to Races' }));
    await waitFor(() => expect(window.location.pathname).toBe('/races'));
    expect(api.called('POST /api/races/record/close')).toBe(true);
  });

  it('finished_before_the_save_does_not_say_the_race_is_in_the_list', async () => {
    stageApi();
    await openStage(liveRace({ phase: 'finished', lap: 8, position: 2, savedRaceId: null }));
    await screen.findByRole('heading', { level: 1, name: 'P 2 of 20' });
    expect(screen.getByText('You started in position 20.')).toBeInTheDocument();
    expect(screen.queryByText(/The race is in your list/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open the race' })).not.toBeInTheDocument();
  });

  it('stopped_with_laps_but_no_saved_race_says_it_could_not_be_stored', async () => {
    stageApi();
    await openStage(liveRace({ phase: 'stopped', savedRaceId: null }), 'idle');
    expect(await screen.findByText('The race could not be stored. Its raw capture stays on this computer.')).toBeInTheDocument();
    expect(screen.queryByText('No complete lap was recorded. Nothing was saved.')).not.toBeInTheDocument();
  });

  it('open_the_race_works_again_after_a_failed_close', async () => {
    let fail = true;
    const api = stageApi().on('POST /api/races/record/close', () => (fail ? { status: 500, body: { code: 'server-error' } } : { ok: true }));
    await openStage(liveRace({ phase: 'finished', lap: 8, position: 2, savedRaceId: RACE_ID }), 'idle');
    await userEvent.click(await screen.findByRole('button', { name: 'Open the race' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong in GT7 Tutor (status 500).');
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Open the race' }));
    await waitFor(() => expect(window.location.pathname).toBe(`/races/${RACE_ID}`));
    expect(api.calls.filter(call => call.path === '/api/races/record/close')).toHaveLength(2);
  });

  it('open_the_race_works_after_a_failed_close', async () => {
    let fail = true;
    stageApi().on('POST /api/races/record/close', () => (fail ? { status: 500, body: { code: 'server-error' } } : { ok: true }));
    await openStage(liveRace({ phase: 'finished', lap: 8, position: 2, savedRaceId: RACE_ID }), 'idle');
    await userEvent.click(await screen.findByRole('button', { name: 'Close' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong in GT7 Tutor (status 500).');
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Open the race' }));
    await waitFor(() => expect(window.location.pathname).toBe(`/races/${RACE_ID}`));
  });

  it('close_after_the_finish_stops_the_automatic_opening', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    stageApi();
    await openStage(liveRace({ phase: 'finished', lap: 8, position: 2, savedRaceId: RACE_ID }), 'idle');
    await screen.findByRole('heading', { level: 1, name: 'P 2 of 20' });
    act(() => {
      screen.getByRole('button', { name: 'Close' }).click();
    });
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    await waitFor(() => expect(window.location.pathname).toBe('/races'));
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(window.location.pathname).toBe('/races');
  });

  it('stop_error_is_shown_on_the_stage', async () => {
    stageApi().on('POST /api/races/record/stop', { status: 503, body: { code: 'shutting-down' } });
    await openStage(liveRace());
    await userEvent.click(await screen.findByRole('button', { name: 'Stop recording' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The server is stopping.');
  });

  it('runs_the_motion_only_without_reduced_motion', async () => {
    stageApi();
    await openStage(WAITING);
    await screen.findByRole('heading', { level: 1, name: 'WAITING' });
    expect(document.querySelector('.race-stage')).toHaveClass('motion');
  });

  it('lets_the_finish_position_rise_in_once', async () => {
    stageApi();
    await openStage(liveRace({ phase: 'finished', lap: 8, position: 2, savedRaceId: RACE_ID }), 'idle');
    expect(await screen.findByRole('heading', { level: 1, name: 'P 2 of 20' })).toHaveClass('rise');
    expect(document.querySelector('.race-stage')).toHaveClass('motion');
  });

  it('has_no_motion_classes_with_reduced_motion', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('prefers-reduced-motion') || /min-width/.test(query),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined
    }));
    stageApi();
    await openStage(liveRace());
    await screen.findByRole('heading', { level: 1, name: 'LAP 3 of 7' });
    expect(document.querySelector('.race-stage')).not.toHaveClass('motion');
    expect(document.querySelector('.lap-circle.now')).not.toBeNull();
    expect(screen.getByRole('img', { name: 'The line of the last lap, brightest at the car' })).toBeInTheDocument();
  });

  it('goes_to_the_list_when_no_race_is_in_the_live_state', async () => {
    stageApi();
    await openStage(null, 'idle');
    await waitFor(() => expect(window.location.pathname).toBe('/races'), { timeout: 3000 });
  });

  describe('status dot', () => {
    async function open(race: LiveRace, connection: 'connected' | 'stale' | 'disconnected') {
      stageApi();
      const view = renderApp({ path: '/races/record' });
      await sendLiveState(view, { mode: race.phase === 'waiting' ? 'race-waiting' : 'race-running', race, connection });
      await screen.findByRole('heading', { level: 1 });
    }

    function status() {
      const root = document.querySelector('.race-status')!;
      return {
        dot: root.querySelector('.race-dot')!.className,
        word: [...root.querySelector('.race-status-word')!.childNodes].find(node => node.nodeType === Node.TEXT_NODE)!.textContent,
        hidden: root.querySelector('.visually-hidden')!.textContent,
        sub: root.querySelector('.race-status-sub')!.textContent
      };
    }

    it('waiting_with_packets_is_green_telemetry', async () => {
      await open(WAITING, 'connected');
      expect(status()).toEqual({ dot: 'race-dot green', word: 'Telemetry', hidden: ': Receiving telemetry', sub: 'Race recording' });
    });

    it('waiting_without_packets_is_grey_no_telemetry', async () => {
      await open(WAITING, 'stale');
      expect(status()).toEqual({ dot: 'race-dot grey', word: 'No telemetry', hidden: ': Waiting for packets', sub: 'Race recording' });
    });

    it('recording_with_packets_is_red_and_names_the_car', async () => {
      await open(liveRace(), 'connected');
      expect(status()).toEqual({ dot: 'race-dot red', word: 'Recording', hidden: ': Receiving telemetry', sub: "BAC Mono '16" });
    });

    it('recording_without_packets_is_yellow_recording_no_telemetry', async () => {
      await open(liveRace(), 'stale');
      expect(status().dot).toBe('race-dot yellow');
      expect(status().word).toBe('Recording \u00b7 no telemetry');
    });

    it('a_recording_that_has_not_started_its_lap_is_yellow_when_the_packets_stop', async () => {
      await open(liveRace({ phase: 'grid', lap: 0 }), 'disconnected');
      expect(status().dot).toBe('race-dot yellow');
    });

    it('has_one_dot_and_no_track_or_length', async () => {
      await open(liveRace(), 'connected');
      expect(document.querySelectorAll('.race-dot')).toHaveLength(1);
      expect(document.querySelector('.race-rec-dot')).toBeNull();
      expect(document.querySelector('.stage-top')!.textContent).not.toMatch(/ m\b/);
    });
  });
});
