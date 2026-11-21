import type { Sample } from '@gt7/contracts';
import type { CoreConfig } from './config.ts';
import { clockOf } from './packet-clock.ts';
import { activeDurationMs, pitLaneOf, type LapFacts, type PitStopFacts } from './race-laps.ts';
import { nearestSM, type ReferencePath } from './reference.ts';
import { median } from './statistics.ts';

export type OffTrackFacts = {
  lap: number;
  rawIndex: number;
  sM: number | null;
  x: number;
  z: number;
  wheels: 2 | 3 | 4;
  durationMs: number;
  speedInMps: number;
  speedMinMps: number;
};

export type RecurringPlace = {
  label: string;
  sM: number;
  fromSM: number;
  toSM: number;
  x: number;
  z: number;
  laps: number[];
  allWheels: number;
  largestLossMps: number;
};

type Run = { lap: number; first: number; last: number; wheels: number };

const ON_TRACK = new Set(['T', 'C']);

function wheelsOff(sample: Sample): number {
  let count = 0;
  for (const letter of sample.surface) if (!ON_TRACK.has(letter)) count++;
  return count;
}

type PitRange = { first: number; last: number };

export function findOffTrack(samples: Sample[], laps: LapFacts[], pitStops: PitStopFacts[], path: ReferencePath | null, config: CoreConfig): OffTrackFacts[] {
  const inPit: PitRange[] = pitStops.map(stop => ({ first: stop.stopRawIndex, last: stop.exitRawIndex }));
  for (const lap of laps) {
    if (!lap.pitOut || pitStops.some(stop => stop.afterLap === lap.number - 1)) continue;
    const exit = pitLaneOf(samples, lap, pitStops, config).exitRawIndex;
    if (exit !== null) inPit.push({ first: lap.range.first, last: exit });
  }
  const runs = offTrackRuns(samples, laps, inPit, config);
  return joinRuns(samples, runs, config).map(run => momentOf(samples, run, path));
}

function lapOf(laps: LapFacts[], rawIndex: number): number | null {
  for (const lap of laps) if (rawIndex >= lap.range.first && rawIndex <= lap.range.last) return lap.number;
  return null;
}

function inPitStop(inPit: PitRange[], rawIndex: number): boolean {
  return inPit.some(range => rawIndex >= range.first && rawIndex <= range.last);
}

function offTrackRuns(samples: Sample[], laps: LapFacts[], pitStops: PitRange[], config: CoreConfig): Run[] {
  const runs: Run[] = [];
  let current: Run | null = null;
  for (let index = 0; index < samples.length; index++) {
    const sample = samples[index]!;
    const lap = lapOf(laps, sample.rawIndex);
    const wheels = wheelsOff(sample);
    if (lap === null || inPitStop(pitStops, sample.rawIndex) || wheels < config.race.offTrackMinWheels) {
      current = null;
    } else if (current === null) {
      current = { lap, first: index, last: index, wheels };
      runs.push(current);
    } else {
      current.last = index;
      current.wheels = Math.max(current.wheels, wheels);
    }
  }
  return runs;
}

function joinRuns(samples: Sample[], runs: Run[], config: CoreConfig): Run[] {
  const joined: Run[] = [];
  for (const run of runs) {
    const previous = joined.at(-1);
    const gapMs = previous ? clockOf(samples[run.first]!) - clockOf(samples[previous.last]!) : Number.POSITIVE_INFINITY;
    if (previous && previous.lap === run.lap && gapMs < config.race.offTrackJoinMs) {
      previous.last = run.last;
      previous.wheels = Math.max(previous.wheels, run.wheels);
    } else {
      joined.push({ ...run });
    }
  }
  return joined;
}

function momentOf(samples: Sample[], run: Run, path: ReferencePath | null): OffTrackFacts {
  const inside = samples.slice(run.first, run.last + 1);
  const first = inside[0]!;
  let speedMinMps = first.speedMps;
  for (const sample of inside) speedMinMps = Math.min(speedMinMps, sample.speedMps);
  return {
    lap: run.lap,
    rawIndex: first.rawIndex,
    sM: path ? nearestSM(path, first.position) : null,
    x: first.position.x,
    z: first.position.z,
    wheels: run.wheels as OffTrackFacts['wheels'],
    durationMs: activeDurationMs(inside),
    speedInMps: first.speedMps,
    speedMinMps
  };
}

type PlacedMoment = OffTrackFacts & { sM: number };

export function recurringPlaces(moments: OffTrackFacts[], config: CoreConfig, lengthM: number | null): RecurringPlace[] {
  const placed = moments.filter((moment): moment is PlacedMoment => moment.sM !== null).sort((a, b) => a.sM - b.sM);
  const chains: PlacedMoment[][] = [];
  for (const moment of placed) {
    const chain = chains.at(-1);
    if (chain && moment.sM - chain.at(-1)!.sM < config.race.recurringWithinM) chain.push(moment);
    else chains.push([moment]);
  }
  const first = chains[0];
  const last = chains.at(-1);
  const wraps = lengthM !== null && first !== undefined && last !== undefined && chains.length > 1 && first[0]!.sM + lengthM - last.at(-1)!.sM < config.race.recurringWithinM;
  if (wraps) chains[0] = [...chains.pop()!, ...first];
  return chains
    .map((chain, index) => placeOf(chain, wraps && index === 0 ? lengthM : null))
    .filter(place => place.laps.length >= config.race.recurringLaps)
    .sort((a, b) => b.laps.length - a.laps.length || a.sM - b.sM)
    .map((place, index) => ({ ...place, label: labelOf(index) }));
}

function labelOf(index: number): string {
  const letter = String.fromCharCode(65 + (index % 26));
  return index < 26 ? letter : `${letter}${Math.floor(index / 26)}`;
}

function placeOf(chain: PlacedMoment[], wrapLengthM: number | null): RecurringPlace {
  const along = (moment: PlacedMoment) => (wrapLengthM !== null && moment.sM > chain.at(-1)!.sM ? moment.sM - wrapLengthM : moment.sM);
  const middle = median(chain.map(along));
  const sM = wrapLengthM !== null && middle < 0 ? middle + wrapLengthM : middle;
  let centre = chain[0]!;
  for (const moment of chain) if (Math.abs(along(moment) - middle) < Math.abs(along(centre) - middle)) centre = moment;
  const laps = [...new Set(chain.map(moment => moment.lap))].sort((a, b) => a - b);
  const allWheelLaps = new Set(chain.filter(moment => moment.wheels === 4).map(moment => moment.lap));
  return {
    label: '',
    sM,
    fromSM: chain[0]!.sM,
    toSM: chain.at(-1)!.sM,
    x: centre.x,
    z: centre.z,
    laps,
    allWheels: allWheelLaps.size,
    largestLossMps: Math.max(...chain.map(moment => moment.speedInMps - moment.speedMinMps))
  };
}
