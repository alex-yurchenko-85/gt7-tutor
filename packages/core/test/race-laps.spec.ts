import { describe, expect, it } from 'vitest';
import type { Sample } from '@gt7/contracts';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { splitLaps } from '../src/race-laps.ts';
import { samplesOf } from './fixtures.ts';
import { FRAME_MS, drive, renumber } from './synthetic.ts';

function lapBefore(first: Sample): Sample {
  return {
    ...first,
    rawIndex: first.rawIndex - 1,
    packetId: first.packetId - 1,
    receivedMonoMs: first.receivedMonoMs - FRAME_MS,
    clockMs: (first.clockMs ?? first.receivedMonoMs) - FRAME_MS,
    lap: first.lap - 1,
    loading: false
  };
}

function withLapsAround(samples: Sample[]): Sample[] {
  const last = samples.at(-1)!;
  const next: Sample = {
    ...last,
    rawIndex: last.rawIndex + 1,
    packetId: last.packetId + 1,
    receivedMonoMs: last.receivedMonoMs + FRAME_MS,
    clockMs: (last.clockMs ?? last.receivedMonoMs) + FRAME_MS,
    lap: last.lap + 1,
    loading: false
  };
  return [lapBefore(samples[0]!), ...samples, next];
}

type LapSpec = { lap: number; count?: number; speedMps?: number; overrides?: Partial<Sample>; first?: Partial<Sample> };

function laps(specs: LapSpec[], fromLapLine = true): Sample[] {
  const samples = renumber(
    specs.flatMap(spec => {
      const speedMps = spec.speedMps ?? 50;
      const count = spec.count ?? 60;
      const points = Array.from({ length: count }, (_, index) => ({ position: { x: (index * speedMps * FRAME_MS) / 1000, y: 0, z: 0 }, speedMps }));
      const samples = drive(points, { lap: spec.lap, lapsInRace: 5, racePosition: 3, ...spec.overrides });
      samples[0] = { ...samples[0]!, ...spec.first };
      return samples;
    })
  );
  return fromLapLine ? [lapBefore(samples[0]!), ...samples] : samples;
}

describe('splitLaps', () => {
  it('gives_the_pit_stop_of_the_real_capture', () => {
    const { pitStops } = splitLaps(withLapsAround(samplesOf('race-pit-stop')), DEFAULT_CONFIG);
    expect(pitStops).toHaveLength(1);
    expect(pitStops[0]!.afterLap).toBe(2);
    expect(pitStops[0]!.durationMs / 1000).toBeCloseTo(35.5, 1);
    expect(Math.round(pitStops[0]!.fuelBefore)).toBe(38);
    expect(pitStops[0]!.fuelAfter).toBe(100);
  });

  it('does_not_take_the_loading_packet_in_the_box_for_the_pit_exit', () => {
    const { pitStops } = splitLaps(withLapsAround(samplesOf('race-pit-stop')), DEFAULT_CONFIG);
    expect(pitStops[0]!.exitRawIndex).toBe(20291);
    expect(pitStops[0]!.stopRawIndex).toBe(18165);
  });

  it('takes_the_first_jump_for_the_pit_exit_when_the_exit_packet_is_lost', () => {
    const samples = withLapsAround(samplesOf('race-pit-stop').filter(sample => sample.rawIndex !== 20291));
    const { pitStops } = splitLaps(samples, DEFAULT_CONFIG);
    expect(pitStops).toEqual([expect.objectContaining({ afterLap: 2, stopRawIndex: 18165, exitRawIndex: 20292, fuelAfter: 100 })]);
  });

  it('gives_no_pit_stop_when_the_samples_end_in_the_box', () => {
    const samples = withLapsAround(samplesOf('race-pit-stop').filter(sample => sample.rawIndex < 20000));
    const { laps: result, pitStops } = splitLaps(samples, DEFAULT_CONFIG);
    expect(pitStops).toEqual([]);
    expect(result.map(lap => [lap.number, lap.pitIn, lap.pitOut])).toEqual([
      [2, true, false],
      [3, false, true]
    ]);
  });

  it('gives_the_top_speed_of_a_very_long_lap', () => {
    const samples = laps([
      { lap: 1, count: 150000, speedMps: 0.5, overrides: { paused: true } },
      { lap: 1, count: 10, speedMps: 60 },
      { lap: 2, overrides: { lastLapMs: 80000 } }
    ]);
    expect(splitLaps(samples, DEFAULT_CONFIG).laps[0]!.topSpeedMps).toBe(60);
  });

  it('marks_the_in_lap_and_the_out_lap', () => {
    const { laps: result } = splitLaps(withLapsAround(samplesOf('race-pit-stop')), DEFAULT_CONFIG);
    expect(result.map(lap => ({ number: lap.number, pitIn: lap.pitIn, pitOut: lap.pitOut }))).toEqual([
      { number: 2, pitIn: true, pitOut: false },
      { number: 3, pitIn: false, pitOut: true }
    ]);
  });

  it('takes_the_lap_time_from_the_first_sample_of_the_next_lap', () => {
    const samples = laps([
      { lap: 1, overrides: { lastLapMs: -1 } },
      { lap: 2, overrides: { lastLapMs: 81000 } },
      { lap: 3, overrides: { lastLapMs: 79500 } }
    ]);
    const { laps: result } = splitLaps(samples, DEFAULT_CONFIG);
    expect(result.map(lap => ({ number: lap.number, range: lap.range, timeMs: lap.timeMs }))).toEqual([
      { number: 1, range: { first: 0, last: 59 }, timeMs: 81000 },
      { number: 2, range: { first: 60, last: 119 }, timeMs: 79500 }
    ]);
  });

  it('leaves_out_a_lap_that_has_no_end', () => {
    const samples = laps([
      { lap: 1, overrides: { lastLapMs: -1 } },
      { lap: 2, overrides: { lastLapMs: 81000 } }
    ]);
    expect(splitLaps(samples, DEFAULT_CONFIG).laps.map(lap => lap.number)).toEqual([1]);
    expect(splitLaps(laps([{ lap: 1 }]), DEFAULT_CONFIG)).toEqual({ laps: [], pitStops: [] });
  });

  it('leaves_out_a_lap_whose_first_lap_line_is_not_in_the_samples', () => {
    const samples = laps(
      [
        { lap: 2, overrides: { lastLapMs: 80000 } },
        { lap: 3, overrides: { lastLapMs: 81000 } },
        { lap: 4, overrides: { lastLapMs: 79000 } }
      ],
      false
    );
    expect(splitLaps(samples, DEFAULT_CONFIG).laps.map(lap => lap.number)).toEqual([3]);
  });

  it('keeps_a_lap_when_a_short_session_loss_comes_just_before_its_lap_line', () => {
    const samples = laps([
      { lap: 1, overrides: { lastLapMs: -1 } },
      { lap: -1, count: 5, overrides: { playerSession: false, lapsInRace: -1 } },
      { lap: 2, overrides: { lastLapMs: 81000 } },
      { lap: 3, overrides: { lastLapMs: 79500 } }
    ]);
    expect(splitLaps(samples, DEFAULT_CONFIG).laps.map(lap => lap.number)).toEqual([1, 2]);
  });

  it('counts_only_player_session_samples_of_lap_1_or_more', () => {
    const samples = laps([
      { lap: 0, overrides: { lastLapMs: -1 } },
      { lap: 1, overrides: { lastLapMs: -1 } },
      { lap: 1, count: 5, overrides: { playerSession: false } },
      { lap: 2, overrides: { lastLapMs: 81000 } }
    ]);
    expect(splitLaps(samples, DEFAULT_CONFIG).laps.map(lap => ({ number: lap.number, range: lap.range }))).toEqual([{ number: 1, range: { first: 60, last: 119 } }]);
  });

  it('gives_positions_top_speed_and_fuel_per_lap', () => {
    const samples = laps([
      { lap: 1, speedMps: 60, overrides: { racePosition: 10, fuel: 100 } },
      { lap: 1, count: 30, speedMps: 70, overrides: { racePosition: 8, fuel: 90 } },
      { lap: 2, speedMps: 65, overrides: { racePosition: 7, fuel: 89, lastLapMs: 80000 } },
      { lap: 2, count: 30, speedMps: 55, overrides: { racePosition: 6, fuel: 80 } },
      { lap: 3, overrides: { racePosition: 6, fuel: 79, lastLapMs: 79000 } }
    ]);
    const { laps: result } = splitLaps(samples, DEFAULT_CONFIG);
    expect(result).toEqual([
      { number: 1, range: { first: 0, last: 89 }, timeMs: 80000, positionStart: 10, positionEnd: 8, topSpeedMps: 70, fuelStart: 100, fuelEnd: 90, pitIn: false, pitOut: false },
      { number: 2, range: { first: 90, last: 179 }, timeMs: 79000, positionStart: 7, positionEnd: 6, topSpeedMps: 65, fuelStart: 89, fuelEnd: 80, pitIn: false, pitOut: false }
    ]);
  });

  it('keeps_the_last_finite_fuel_value_when_a_fuel_value_is_not_finite', () => {
    const samples = laps([
      { lap: 1, count: 30, overrides: { fuel: 60 } },
      { lap: 1, count: 30, overrides: { fuel: Number.NaN } },
      { lap: 2, count: 30, overrides: { fuel: Number.POSITIVE_INFINITY, lastLapMs: 80000 } },
      { lap: 2, count: 30, overrides: { fuel: 58 } },
      { lap: 3, overrides: { fuel: 57, lastLapMs: 79000 } }
    ]);
    const { laps: result } = splitLaps(samples, DEFAULT_CONFIG);
    expect(result.map(lap => [lap.fuelStart, lap.fuelEnd])).toEqual([
      [60, 60],
      [60, 58]
    ]);
  });

  it('finds_a_pit_stop_in_synthetic_laps', () => {
    const samples = laps([
      { lap: 1, count: 40, overrides: { fuel: 40 } },
      { lap: 1, count: 30, speedMps: 0.03, overrides: { fuel: 40 } },
      { lap: 2, count: 20, speedMps: 0.001, overrides: { fuel: 70 }, first: { loading: true, lastLapMs: 90000, fuel: 40 } },
      { lap: 2, count: 20, speedMps: 0.001, overrides: { fuel: 100 } },
      { lap: 2, count: 40, speedMps: 22, overrides: { fuel: 99 }, first: { loading: true } },
      { lap: 3, overrides: { fuel: 70, lastLapMs: 95000 } }
    ]);
    const jumped = samples.map(sample => (sample.rawIndex >= 110 ? { ...sample, position: { ...sample.position, x: sample.position.x + 500 } } : sample));
    const { laps: result, pitStops } = splitLaps(jumped, DEFAULT_CONFIG);
    expect(pitStops).toEqual([{ afterLap: 1, durationMs: expect.closeTo((110 - 40) * FRAME_MS, 6), fuelBefore: 40, fuelAfter: 100, stopRawIndex: 40, exitRawIndex: 110 }]);
    expect(result.map(lap => [lap.pitIn, lap.pitOut])).toEqual([
      [true, false],
      [false, true]
    ]);
  });

  it('the_pit_stop_time_leaves_out_a_pause', () => {
    const samples = laps([
      { lap: 1, count: 40, overrides: { fuel: 40 } },
      { lap: 1, count: 30, speedMps: 0.03, overrides: { fuel: 40 } },
      { lap: 2, count: 20, speedMps: 0.001, overrides: { fuel: 70 }, first: { loading: true, lastLapMs: 90000, fuel: 40 } },
      { lap: 2, count: 20, speedMps: 0.001, overrides: { fuel: 100, paused: true } },
      { lap: 2, count: 40, speedMps: 22, overrides: { fuel: 99 }, first: { loading: true } },
      { lap: 3, overrides: { fuel: 70, lastLapMs: 95000 } }
    ]);
    const jumped = samples.map(sample => (sample.rawIndex >= 110 ? { ...sample, position: { ...sample.position, x: sample.position.x + 500 } } : sample));
    expect(splitLaps(jumped, DEFAULT_CONFIG).pitStops[0]!.durationMs).toBeCloseTo((110 - 40 - 21) * FRAME_MS, 6);
  });
});
