import { describe, expect, it } from 'vitest';
import type { Sample } from '@gt7/contracts';
import { DEFAULT_CONFIG } from '@gt7/core';
import { LiveRaceTracker, type TrackerOutcome } from '../../src/races/live-race.js';
import { FRAME_MS, raceOf, renumber, syntheticSample } from '../../../../packages/core/test/synthetic.js';

const carName = (carId: number) => (carId === 3602 ? 'Test Car' : null);

function tracked(samples: Sample[]): { tracker: LiveRaceTracker; outcomes: TrackerOutcome[] } {
  const tracker = new LiveRaceTracker(DEFAULT_CONFIG);
  const outcomes = samples.map(sample => tracker.push(sample));
  return { tracker, outcomes };
}

function upTo(samples: Sample[], predicate: (sample: Sample) => boolean): Sample[] {
  return samples.slice(0, samples.findIndex(predicate) + 1);
}

function sessionLost(count: number): Sample[] {
  return Array.from({ length: count }, () => syntheticSample({ lap: -1, lapsInRace: -1, racePosition: -1, carsInRace: -1, playerSession: false }));
}

describe('LiveRaceTracker', () => {
  const race = raceOf({ laps: [60000, 58000, 59000], lapsInRace: 3 });

  it('waits before the first sample', () => {
    expect(new LiveRaceTracker(DEFAULT_CONFIG).live(carName)).toEqual({
      phase: 'waiting',
      unsupported: false,
      lap: 0,
      lapsInRace: 0,
      firstRecordedLap: null,
      position: 0,
      startPosition: null,
      cars: 0,
      lapTimeMs: 0,
      lastLapMs: null,
      bestLap: null,
      bestLapMs: null,
      laps: [],
      fuel: 0,
      fuelLapsLeft: null,
      x: 0,
      z: 0,
      carName: null,
      savedRaceId: null
    });
  });

  it('shows the grid with the laps, the cars and the start position', () => {
    const { tracker, outcomes } = tracked(race.filter(sample => sample.lap === 0));
    expect(outcomes.every(outcome => outcome === 'none')).toBe(true);
    expect(tracker.live(carName)).toMatchObject({ phase: 'grid', lap: 0, lapsInRace: 3, firstRecordedLap: 1, position: 8, startPosition: null, cars: 16, lapTimeMs: 0, carName: 'Test Car' });
    expect(tracker.active).toBe(true);
  });

  it('gives the lap, the lap time and the position of the car while a lap runs', () => {
    const samples = upTo(race, sample => sample.lap === 1 && sample.gameTimerMs >= 1000);
    const last = samples.at(-1)!;
    const { tracker } = tracked(samples);
    expect(tracker.live(carName)).toMatchObject({ phase: 'lap', lap: 1, lapTimeMs: last.gameTimerMs, position: 8, x: last.position.x, z: last.position.z, laps: [], lastLapMs: null });
  });

  it('keeps the position of the last grid sample as the start position', () => {
    const grid = race.filter(sample => sample.lap === 0).map((sample, index, all) => (index === all.length - 1 ? { ...sample, racePosition: 12 } : sample));
    const { tracker } = tracked(renumber([...grid, ...upTo(race, sample => sample.lap === 2).filter(sample => sample.lap > 0).map(sample => ({ ...sample, racePosition: 3 }))]));
    expect(tracker.live(carName)).toMatchObject({ lap: 2, position: 3, startPosition: 12 });
  });

  it('takes the start position at the first recorded lap after a join', () => {
    const joined = raceOf({ laps: [60000, 58000, 59000, 61000], lapsInRace: 4, joinAtLap: 2 }).map(sample => ({ ...sample, racePosition: sample.lap + 4 }));
    const { tracker: before } = tracked(upTo(joined, sample => sample.lap === 2));
    expect(before.live(carName)).toMatchObject({ phase: 'joined', startPosition: null });
    const { tracker } = tracked(upTo(joined, sample => sample.lap === 4));
    expect(tracker.live(carName)).toMatchObject({ firstRecordedLap: 3, startPosition: 7 });
  });

  it('gives 0 as the lap time at the first sample of a lap', () => {
    const lapLine = race.findIndex(sample => sample.lap === 2);
    const samples = race.slice(0, lapLine + 1).map((sample, index) => (index === lapLine ? { ...sample, gameTimerMs: 59990 } : sample));
    expect(tracked(samples).tracker.live(carName).lapTimeMs).toBe(0);
  });

  it('lists the recorded laps with the last and the best lap', () => {
    const { tracker } = tracked(upTo(race, sample => sample.lap === 3));
    expect(tracker.live(carName)).toMatchObject({
      phase: 'lap',
      lap: 3,
      position: 6,
      laps: [
        { number: 1, timeMs: 60000, pitAfter: false },
        { number: 2, timeMs: 58000, pitAfter: false }
      ],
      lastLapMs: 58000,
      bestLap: 2,
      bestLapMs: 58000
    });
  });

  it('estimates the laps left from the fuel use of the recorded laps', () => {
    const samples = upTo(race, sample => sample.lap === 2);
    const fuel = samples.at(-1)!.fuel;
    const lap1 = samples.filter(sample => sample.lap === 1);
    const use = lap1[0]!.fuel - lap1.at(-1)!.fuel;
    const { tracker } = tracked(samples);
    expect(tracker.live(carName).fuel).toBe(fuel);
    expect(tracker.live(carName).fuelLapsLeft).toBeCloseTo(fuel / use, 9);
  });

  it('gives no estimate before the first lap or when the use is under 0.5 per lap', () => {
    expect(tracked(upTo(race, sample => sample.lap === 1 && sample.gameTimerMs > 5000)).tracker.live(carName).fuelLapsLeft).toBeNull();
    const fullTank = upTo(race, sample => sample.lap === 2).map(sample => ({ ...sample, fuel: 100 }));
    expect(tracked(fullTank).tracker.live(carName).fuelLapsLeft).toBeNull();
  });

  it('marks the lap before a pit stop and leaves the in-lap and the out-lap out of the estimate', () => {
    const pitRace = raceOf({ laps: [60000, 58000, 59000, 61000], lapsInRace: 4, pitAfter: [1] });
    const atLap3 = tracked(upTo(pitRace, sample => sample.lap === 3)).tracker.live(carName);
    expect(atLap3.laps).toEqual([
      { number: 1, timeMs: 60000, pitAfter: true },
      { number: 2, timeMs: 58000, pitAfter: false }
    ]);
    expect(atLap3.fuelLapsLeft).toBeNull();
    const atLap4 = tracked(upTo(pitRace, sample => sample.lap === 4)).tracker.live(carName);
    const lap3 = pitRace.filter(sample => sample.lap === 3);
    expect(atLap4.fuelLapsLeft).toBeCloseTo(atLap4.fuel / (lap3[0]!.fuel - lap3.at(-1)!.fuel), 9);
  });

  it('keeps the last finite fuel value', () => {
    const samples = upTo(race, sample => sample.lap === 1);
    const fuel = samples.at(-1)!.fuel;
    const { tracker } = tracked([...samples, { ...samples.at(-1)!, rawIndex: samples.length, fuel: Number.NaN }]);
    expect(tracker.live(carName).fuel).toBe(fuel);
  });

  it('gives finish at the finish and keeps the phase finished', () => {
    const { tracker, outcomes } = tracked(race);
    expect(outcomes.filter(outcome => outcome !== 'none')).toEqual(['finish']);
    expect(outcomes.indexOf('finish')).toBe(race.findIndex(sample => sample.lap === 4));
    expect(tracker.live(carName)).toMatchObject({ phase: 'finished', lap: 4, laps: [{ number: 1 }, { number: 2 }, { number: 3, timeMs: 59000 }], bestLap: 2 });
    expect(tracker.active).toBe(false);
  });

  it('gives ended when the session ends during the race', () => {
    const { outcomes } = tracked(raceOf({ laps: [60000, 58000], lapsInRace: 3 }));
    expect(outcomes.filter(outcome => outcome !== 'none')).toEqual(['ended']);
  });

  it('keeps the lap phase after the race ended until the recorder stores it', () => {
    const { tracker, outcomes } = tracked(raceOf({ laps: [60000, 58000], lapsInRace: 3 }));
    expect(outcomes).toContain('ended');
    expect(tracker.live(carName).phase).toBe('lap');
    expect(tracker.active).toBe(false);
  });

  it('waits again when a grid ends before the start', () => {
    const grid = race.filter(sample => sample.lap === 0);
    const samples = renumber([...grid, ...sessionLost(120), ...race]);
    const { tracker, outcomes } = tracked(samples.slice(0, grid.length + 120));
    expect(outcomes.every(outcome => outcome === 'none')).toBe(true);
    expect(tracker.live(carName)).toMatchObject({ phase: 'waiting', lapsInRace: 0, firstRecordedLap: null });
    for (const sample of samples.slice(grid.length + 120)) tracker.push(sample);
    expect(tracker.live(carName)).toMatchObject({ phase: 'finished', laps: [{ number: 1 }, { number: 2 }, { number: 3 }] });
  });

  it('joins a race that runs, shows the lap that runs and records from the next lap line', () => {
    const joined = raceOf({ laps: [60000, 58000, 59000, 61000], lapsInRace: 4, joinAtLap: 2 });
    const before = tracked(joined.slice(0, 10)).tracker.live(carName);
    expect(before).toMatchObject({ phase: 'joined', lap: 2, lapsInRace: 4, firstRecordedLap: 3, laps: [], lastLapMs: null });
    const after = tracked(upTo(joined, sample => sample.lap === 3)).tracker.live(carName);
    expect(after).toMatchObject({ phase: 'lap', lap: 3, laps: [], lastLapMs: 58000, bestLap: null, fuelLapsLeft: null });
    const later = tracked(upTo(joined, sample => sample.lap === 4)).tracker.live(carName);
    expect(later).toMatchObject({ laps: [{ number: 3, timeMs: 59000, pitAfter: false }], bestLap: 3, bestLapMs: 59000 });
    expect(later.fuelLapsLeft).not.toBeNull();
  });

  it('waits again when a joined race ends before its first lap line', () => {
    const joined = raceOf({ laps: [60000, 58000, 59000, 61000], lapsInRace: 4, joinAtLap: 2 });
    const samples = renumber([...joined.slice(0, 50), ...sessionLost(120)]);
    const { tracker, outcomes } = tracked(samples);
    expect(outcomes.every(outcome => outcome === 'none')).toBe(true);
    expect(tracker.live(carName).phase).toBe('waiting');
  });

  it('marks a session without a lap count as unsupported', () => {
    const licence = renumber(Array.from({ length: Math.ceil(5100 / FRAME_MS) }, () => syntheticSample({ lap: 1, lapsInRace: 1, carsInRace: 1, racePosition: 1 })));
    const { tracker, outcomes } = tracked(licence);
    expect(outcomes.every(outcome => outcome === 'none')).toBe(true);
    expect(tracker.live(carName)).toMatchObject({ phase: 'waiting', unsupported: true });
  });
});
