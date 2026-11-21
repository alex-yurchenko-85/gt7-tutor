import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { LiveRace } from '@gt7/contracts';
import { ApiStub, renderApp, sendLiveState, setViewportWidth, signedIn } from './support.tsx';

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
    laps: [],
    fuel: 91,
    fuelLapsLeft: null,
    x: 0,
    z: 0,
    carName: null,
    savedRaceId: null,
    ...overrides
  };
}

function barApi(): ApiStub {
  return signedIn(new ApiStub())
    .on('GET /api/races', [])
    .on('POST /api/races/record/stop', { raceId: null })
    .install();
}

async function barFor(race: LiveRace, path = '/races') {
  const view = renderApp({ path });
  await sendLiveState(view, { mode: race.phase === 'waiting' ? 'race-waiting' : 'race-running', race });
  return screen.findByRole('status', { name: 'Race recording' });
}

describe('running race bar', () => {
  it.each([
    [liveRace({ phase: 'waiting', lap: 0, position: -1, cars: -1 }), 'Waiting for the race. Start a race by laps in the game.'],
    [liveRace({ phase: 'waiting', unsupported: true }), 'This is not a race of 2 or more laps. Only a race by laps can be recorded.'],
    [liveRace({ phase: 'grid', lap: 0 }), 'Recording a race · lap 1 of 7'],
    [liveRace({ phase: 'joined', lap: 4, firstRecordedLap: 5 }), 'Recording a race · it starts at the next lap line'],
    [liveRace(), 'Recording a race · lap 3 of 7']
  ])('bar_text_%#', async (race, text) => {
    barApi();
    const bar = await barFor(race);
    expect(bar).toHaveTextContent(text);
    expect(within(bar).getByRole('link', { name: 'Open the recording' })).toHaveAttribute('href', '/races/record');
  });

  it('bar_stops_the_recording', async () => {
    const api = barApi();
    const bar = await barFor(liveRace(), '/races');
    await userEvent.click(within(bar).getByRole('button', { name: 'Stop recording' }));
    await waitFor(() => expect(api.called('POST /api/races/record/stop')).toBe(true));
  });

  it('bar_is_shown_on_a_phone', async () => {
    setViewportWidth(390);
    barApi();
    expect(await barFor(liveRace(), '/races')).toBeInTheDocument();
  });

  it('bar_is_not_on_the_recording_stage', async () => {
    barApi();
    const view = renderApp({ path: '/races/record' });
    await sendLiveState(view, { mode: 'race-running', race: liveRace() });
    await screen.findByRole('heading', { level: 1, name: 'LAP 3 of 7' });
    expect(screen.queryByRole('status', { name: 'Race recording' })).not.toBeInTheDocument();
  });

  it('bar_is_not_shown_after_the_finish_or_a_stop', async () => {
    barApi();
    const view = renderApp({ path: '/races' });
    await sendLiveState(view, { mode: 'idle', race: liveRace({ phase: 'finished', savedRaceId: 'a0000000-0000-4000-8000-000000000001' }) });
    await screen.findByRole('heading', { level: 2, name: /My races/ });
    expect(screen.queryByRole('status', { name: 'Race recording' })).not.toBeInTheDocument();
    await sendLiveState(view, { mode: 'idle', race: liveRace({ phase: 'stopped' }), seq: 2 });
    expect(screen.queryByRole('status', { name: 'Race recording' })).not.toBeInTheDocument();
  });

  it('capture_bar_is_not_shown_in_a_race_mode', async () => {
    barApi();
    await barFor(liveRace(), '/races');
    expect(screen.queryByText(/A recording is running/)).not.toBeInTheDocument();
  });
});
