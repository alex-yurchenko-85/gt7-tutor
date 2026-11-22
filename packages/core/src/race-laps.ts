import type { RawRange, Sample } from '@gt7/contracts';
import { positionBreak } from './attempts.ts';
import type { CoreConfig } from './config.ts';
import { clockOf } from './packet-clock.ts';

export type LapFacts = {
  number: number;
  range: RawRange;
  timeMs: number;
  positionStart: number;
  positionEnd: number;
  topSpeedMps: number;
  fuelStart: number;
  fuelEnd: number;
  pitIn: boolean;
  pitOut: boolean;
};

export type PitStopFacts = {
  afterLap: number;
  durationMs: number;
  fuelBefore: number;
  fuelAfter: number;
  stopRawIndex: number;
  exitRawIndex: number;
};

type LapSamples = { number: number; samples: Sample[]; fromLapLine: boolean };

export function splitLaps(samples: Sample[], config: CoreConfig): { laps: LapFacts[]; pitStops: PitStopFacts[] } {
  const groups = lapGroups(withFiniteFuel(samples));
  const laps: LapFacts[] = [];
  const pitStops: PitStopFacts[] = [];
  for (let index = 0; index + 1 < groups.length; index++) {
    const lap = groups[index]!;
    const next = groups[index + 1]!;
    if (next.number !== lap.number + 1 || !lap.fromLapLine) continue;
    const pitIn = next.samples[0]!.loading;
    const previous = groups[index - 1];
    const pitOut = previous !== undefined && previous.number === lap.number - 1 && lap.samples[0]!.loading;
    laps.push(lapFacts(lap, next, pitIn, pitOut));
    const stop = pitIn ? pitStop(lap, next, config) : null;
    if (stop) pitStops.push(stop);
  }
  return { laps, pitStops };
}

export function activeDurationMs(samples: Sample[]): number {
  let durationMs = 0;
  for (let index = 1; index < samples.length; index++) {
    const sample = samples[index]!;
    const previous = samples[index - 1]!;
    if (!sample.paused && !previous.paused) durationMs += clockOf(sample) - clockOf(previous);
  }
  return durationMs;
}

export function withFiniteFuel(samples: Sample[]): Sample[] {
  let last = samples.find(sample => Number.isFinite(sample.fuel))?.fuel ?? 0;
  return samples.map(sample => {
    if (Number.isFinite(sample.fuel)) {
      last = sample.fuel;
      return sample;
    }
    return { ...sample, fuel: last };
  });
}

function lapGroups(samples: Sample[]): LapSamples[] {
  const groups: LapSamples[] = [];
  let before: number | null = null;
  for (const sample of samples) {
    if (!sample.playerSession) continue;
    const previousLap = before;
    before = sample.lap;
    if (sample.lap < 1) continue;
    const current = groups.at(-1);
    if (current && current.number === sample.lap) current.samples.push(sample);
    else groups.push({ number: sample.lap, samples: [sample], fromLapLine: previousLap === sample.lap - 1 || previousLap === 0 });
  }
  return groups;
}

function lapFacts(lap: LapSamples, next: LapSamples, pitIn: boolean, pitOut: boolean): LapFacts {
  const first = lap.samples[0]!;
  const last = lap.samples.at(-1)!;
  return {
    number: lap.number,
    range: { first: first.rawIndex, last: last.rawIndex },
    timeMs: next.samples[0]!.lastLapMs,
    positionStart: first.racePosition,
    positionEnd: last.racePosition,
    topSpeedMps: highest(lap.samples, sample => sample.speedMps),
    fuelStart: first.fuel,
    fuelEnd: last.fuel,
    pitIn,
    pitOut
  };
}

function highest(samples: Sample[], value: (sample: Sample) => number): number {
  let result = Number.NEGATIVE_INFINITY;
  for (const sample of samples) result = Math.max(result, value(sample));
  return result;
}

function pitStop(lap: LapSamples, next: LapSamples, config: CoreConfig): PitStopFacts | null {
  const stop = stopSample(lap, config) ?? next.samples[0]!;
  const exitIndex = exitIndexOf(next.samples, config);
  if (exitIndex === null) return null;
  const exit = next.samples[exitIndex]!;
  const stopped = [...lap.samples.filter(sample => sample.rawIndex >= stop.rawIndex), ...next.samples.slice(0, exitIndex + 1)];
  return {
    afterLap: lap.number,
    durationMs: activeDurationMs(stopped),
    fuelBefore: stop.fuel,
    fuelAfter: highest(next.samples.slice(0, exitIndex + 1), sample => sample.fuel),
    stopRawIndex: stop.rawIndex,
    exitRawIndex: exit.rawIndex
  };
}

function stopSample(lap: LapSamples, config: CoreConfig): Sample | undefined {
  let stop: Sample | undefined;
  for (let index = lap.samples.length - 1; index >= 0; index--) {
    const sample = lap.samples[index]!;
    if (sample.speedMps > config.race.pitStoppedMps) break;
    stop = sample;
  }
  return stop;
}

export function fastestLap<T extends { timeMs: number }>(laps: T[]): T | undefined {
  return laps.reduce<T | undefined>((best, lap) => (best === undefined || lap.timeMs < best.timeMs ? lap : best), undefined);
}

export function bestLapOf<T extends { timeMs: number }>(laps: T[], hasPit: (lap: T) => boolean): T | undefined {
  const withoutPit = laps.filter(lap => !hasPit(lap));
  return fastestLap(withoutPit.length > 0 ? withoutPit : laps);
}

export type PitLane = { stopRawIndex: number | null; exitRawIndex: number | null };

export function isClosedLap(lap: { number: number; pitIn: boolean; pitOut: boolean }): boolean {
  return lap.number !== 1 && !lap.pitIn && !lap.pitOut;
}

export function lapSamples(samples: Sample[], lap: LapFacts, first = lap.range.first, last = lap.range.last): Sample[] {
  return samples.filter(sample => sample.playerSession && sample.lap === lap.number && sample.rawIndex >= first && sample.rawIndex <= last);
}

export function drivenLap(samples: Sample[], lap: LapFacts, pitStops: PitStopFacts[], config: CoreConfig): { samples: Sample[]; exitRawIndex: number | null } {
  const { stopRawIndex, exitRawIndex } = pitLaneOf(samples, lap, pitStops, config);
  const first = exitRawIndex === null ? lap.range.first : Math.max(lap.range.first, exitRawIndex);
  const last = stopRawIndex === null ? lap.range.last : Math.min(lap.range.last, stopRawIndex - 1);
  return { samples: lapSamples(samples, lap, first, last), exitRawIndex };
}

export function pitLaneOf(samples: Sample[], lap: LapFacts, pitStops: PitStopFacts[], config: CoreConfig): PitLane {
  const stopRawIndex = pitStops.find(stop => stop.afterLap === lap.number)?.stopRawIndex ?? null;
  const known = pitStops.find(stop => stop.afterLap === lap.number - 1)?.exitRawIndex;
  if (known !== undefined || !lap.pitOut) return { stopRawIndex, exitRawIndex: known ?? null };
  const inLap = lapSamples(samples, lap);
  const exitIndex = exitIndexOf(inLap, config);
  return { stopRawIndex, exitRawIndex: exitIndex === null ? null : inLap[exitIndex]!.rawIndex };
}

function exitIndexOf(lapSamples: Sample[], config: CoreConfig): number | null {
  let jumpIndex: number | null = null;
  for (let index = 1; index < lapSamples.length; index++) {
    const sample = lapSamples[index]!;
    if (positionBreak(lapSamples[index - 1]!, sample, config) !== 'discontinuity') continue;
    if (sample.loading) return index;
    jumpIndex ??= index;
  }
  return jumpIndex;
}
