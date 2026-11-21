import type { RawRange, Sample } from '@gt7/contracts';
import type { CoreConfig } from './config.ts';
import { findOffTrack, recurringPlaces, type OffTrackFacts, type RecurringPlace } from './race-off-track.ts';
import { drivenLap, isClosedLap, lapSamples, splitLaps, withFiniteFuel, type LapFacts, type PitStopFacts } from './race-laps.ts';
import { RaceWatch } from './race-watch.ts';
import { buildReference, type ReferencePath } from './reference.ts';

export type PositionStep = { tMs: number; position: number };

export type FuelPoint = { tMs: number; fuel: number };

export type DistancePoint = { lap: number; tMs: number; sM: number };

export type RaceAnalysis = {
  range: RawRange;
  firstLap: number;
  complete: boolean;
  carId: number;
  lapsInRace: number;
  carsInRace: number;
  startPosition: number;
  finishPosition: number;
  raceMs: number;
  bestLap: number;
  bestLapMs: number;
  referenceLap: number;
  lapLengthM: number | null;
  laps: LapFacts[];
  pitStops: PitStopFacts[];
  offTrack: OffTrackFacts[];
  recurring: RecurringPlace[];
  position: PositionStep[];
  fuel: FuelPoint[];
};

type TimedSample = { sample: Sample; tMs: number };

export function raceRange(samples: Sample[], config: CoreConfig): RawRange | null {
  let watch = new RaceWatch(config);
  let first: number | null = null;
  let finishMs: number | null = null;
  let last: number | null = null;
  let lapLine: 'none' | 'not-yet' | 'passed' = 'none';
  for (const sample of samples) {
    if (finishMs !== null) {
      if (sample.receivedMonoMs - finishMs > config.race.afterFinishMs) break;
      last = sample.rawIndex;
      continue;
    }
    for (const event of watch.push(sample)) {
      if (event.type === 'grid' || event.type === 'join') {
        first = event.rawIndex;
        lapLine = event.type === 'grid' ? 'none' : 'not-yet';
      }
      if (event.type === 'start') lapLine = 'passed';
      if (event.type === 'lap' && lapLine === 'not-yet') lapLine = 'passed';
      if (event.type === 'finish') finishMs = sample.receivedMonoMs;
      if (event.type === 'ended' && lapLine === 'passed') return { first: first!, last: event.rawIndex };
      if (event.type === 'ended') {
        watch = new RaceWatch(config);
        first = null;
      }
    }
    if (first !== null) last = sample.rawIndex;
  }
  return first === null || last === null ? null : { first, last };
}

export function analyseRace(samples: Sample[], config: CoreConfig): RaceAnalysis | null {
  const range = raceRange(samples, config);
  if (range === null) return null;
  const race = withFiniteFuel(samples.filter(sample => sample.rawIndex >= range.first && sample.rawIndex <= range.last));
  const { laps, pitStops } = splitLaps(race, config);
  if (laps.length === 0) return null;
  const grid = race[0]!;
  const firstLapSample = race.find(sample => sample.rawIndex === laps[0]!.range.first)!;
  const best = fastest(laps);
  const { referenceLap, path, lapLengthM } = reference(race, laps, pitStops, config);
  const offTrack = findOffTrack(race, laps, pitStops, path, config);
  const timed = raceTimes(race, laps);
  const firstLap = laps[0]!.number;
  return {
    range,
    firstLap,
    complete: firstLap === 1 && laps.length === grid.lapsInRace,
    carId: firstLapSample.carId,
    lapsInRace: grid.lapsInRace,
    carsInRace: firstLapSample.carsInRace,
    startPosition: firstLap === 1 ? startPosition(race, firstLapSample) : timed[0]!.sample.racePosition,
    finishPosition: timed.at(-1)!.sample.racePosition,
    raceMs: laps.reduce((sum, lap) => sum + lap.timeMs, 0),
    bestLap: best.number,
    bestLapMs: best.timeMs,
    referenceLap: referenceLap.number,
    lapLengthM,
    laps,
    pitStops,
    offTrack,
    recurring: recurringPlaces(offTrack, config, isClosedLap(referenceLap) ? lapLengthM : null),
    position: positionSteps(timed),
    fuel: fuelPoints(timed, config)
  };
}

function fastest(laps: LapFacts[]): LapFacts {
  return laps.reduce((best, lap) => (lap.timeMs < best.timeMs ? lap : best));
}

type Reference = { referenceLap: LapFacts; path: ReferencePath | null; lapLengthM: number | null };

function reference(race: Sample[], laps: LapFacts[], pitStops: PitStopFacts[], config: CoreConfig): Reference {
  const paths = new Map<number, ReferencePath | null>();
  const pathOf = (lap: LapFacts): ReferencePath | null => {
    if (!paths.has(lap.number)) paths.set(lap.number, lapPath(race, lap, pitStops, config));
    return paths.get(lap.number)!;
  };
  const byTime = [...laps].sort((a, b) => a.timeMs - b.timeMs);
  const closed = byTime.find(lap => isClosedLap(lap) && pathOf(lap) !== null);
  if (closed !== undefined) return { referenceLap: closed, path: pathOf(closed)!, lapLengthM: pathOf(closed)!.lengthM };
  const withPath = byTime.filter(lap => pathOf(lap) !== null);
  const referenceLap = withPath[0];
  if (referenceLap === undefined) return { referenceLap: fastest(laps), path: null, lapLengthM: null };
  return { referenceLap, path: pathOf(referenceLap)!, lapLengthM: Math.max(...withPath.map(lap => pathOf(lap)!.lengthM)) };
}

function startPosition(race: Sample[], firstLapSample: Sample): number {
  let position = firstLapSample.racePosition;
  for (const sample of race) {
    if (sample.rawIndex >= firstLapSample.rawIndex) break;
    if (sample.playerSession && sample.lap === 0) position = sample.racePosition;
  }
  return position;
}

function raceTimes(race: Sample[], laps: LapFacts[]): TimedSample[] {
  const timed: TimedSample[] = [];
  let earlierMs = 0;
  for (const lap of laps) {
    lapSamples(race, lap).forEach((sample, index) => timed.push({ sample, tMs: earlierMs + (index === 0 ? 0 : Math.max(0, sample.gameTimerMs)) }));
    earlierMs += lap.timeMs;
  }
  const lastLap = laps.at(-1)!;
  const finish = race.find(sample => sample.playerSession && sample.lap === lastLap.number + 1 && sample.rawIndex > lastLap.range.last);
  if (finish) timed.push({ sample: finish, tMs: earlierMs });
  return timed;
}

function positionSteps(timed: TimedSample[]): PositionStep[] {
  const steps: PositionStep[] = [];
  for (const { sample, tMs } of timed) {
    if (steps.at(-1)?.position !== sample.racePosition) steps.push({ tMs, position: sample.racePosition });
  }
  return steps;
}

function fuelPoints(timed: TimedSample[], config: CoreConfig): FuelPoint[] {
  const points: FuelPoint[] = [];
  timed.forEach(({ sample, tMs }, index) => {
    const previous = points.at(-1);
    const isLast = index === timed.length - 1;
    if (previous === undefined || tMs - previous.tMs >= config.race.fuelStepMs || (isLast && tMs > previous.tMs)) points.push({ tMs, fuel: sample.fuel });
  });
  return points;
}

export function raceDistances(samples: Sample[], analysis: RaceAnalysis, config: CoreConfig): DistancePoint[] {
  const race = samples.filter(sample => sample.rawIndex >= analysis.range.first && sample.rawIndex <= analysis.range.last);
  const numbers = new Set(analysis.laps.map(lap => lap.number));
  const timed = raceTimes(race, analysis.laps).filter(({ sample }) => numbers.has(sample.lap));
  const points: DistancePoint[] = [];
  let sM = 0;
  timed.forEach(({ sample, tMs }, index) => {
    const previous = timed[index - 1];
    const lapStart = previous === undefined || previous.sample.lap !== sample.lap;
    sM = lapStart ? 0 : sM + Math.hypot(sample.position.x - previous.sample.position.x, sample.position.z - previous.sample.position.z);
    const lapEnd = timed[index + 1]?.sample.lap !== sample.lap;
    const last = points.at(-1);
    if (lapStart || lapEnd || tMs - last!.tMs >= config.race.distanceStepMs) {
      const sameTime = last !== undefined && last.lap === sample.lap && last.tMs === tMs;
      if (!sameTime) points.push({ lap: sample.lap, tMs, sM });
      else if (last.sM > 0) points[points.length - 1] = { lap: sample.lap, tMs, sM };
    }
  });
  return points;
}

export function lapPath(samples: Sample[], lap: LapFacts, pitStops: PitStopFacts[], config: CoreConfig): ReferencePath | null {
  try {
    return buildReference(drivenLap(samples, lap, pitStops, config).samples, config);
  } catch {
    return null;
  }
}

export function trackCandidates<T extends { name: string; lengthM: number }>(lapLengthM: number, circuits: T[], config: CoreConfig): T[] {
  return circuits
    .filter(circuit => Math.abs(circuit.lengthM - lapLengthM) <= config.race.trackWithinM)
    .sort((a, b) => Math.abs(a.lengthM - lapLengthM) - Math.abs(b.lengthM - lapLengthM));
}
