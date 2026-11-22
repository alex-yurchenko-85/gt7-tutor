import type { Sample } from '@gt7/contracts';
import { buildReview, type Review } from './compare.ts';
import type { CoreConfig } from './config.ts';
import { findDifferences, type Finding } from './findings.ts';
import { lapPath, type RaceAnalysis } from './race-analysis.ts';
import { drivenLap, type LapFacts } from './race-laps.ts';
import { analysisOf, type ReferenceAnalysis } from './reference-analysis.ts';
import { distance } from './geometry.ts';
import { nearestSM, pointAt, type ReferencePath } from './reference.ts';
import { turnLosses, turnZones, type TurnLoss, type TurnZone } from './turns.ts';

export type LapCompare = { review: Review; findings: Finding[]; turnLosses: TurnLoss[]; lapMs: number; withMs: number };

export type LapsSpeed = { gridM: number; lengthM: number; turns: TurnZone[]; laps: { number: number; v: (number | null)[] }[] };

export type OffTrackView = {
  gridM: number;
  lengthM: number;
  x: number[];
  z: number[];
  heightM: number[];
  speedMps: number[];
  pitLane: { lap: number; fromSM: number; toSM: number }[];
};

type LapRun = { samples: Sample[]; startSM: number | undefined };

export function raceCompareConfig(config: CoreConfig): CoreConfig {
  return {
    ...config,
    match: { ...config.match, lateralM: config.race.matchLateralM, searchLateralM: config.race.matchLateralM, heightM: config.race.matchHeightM },
    findings: {
      ...config.findings,
      eventWindowM: config.race.eventWindowM,
      offLineM: config.race.offLineM,
      brakeM: config.race.brakeM,
      throttleLateM: config.race.throttleLateM,
      slowCornerMps: config.race.slowCornerMps
    }
  };
}

export function lapOf(analysis: RaceAnalysis, number: number): LapFacts | undefined {
  return analysis.laps.find(lap => lap.number === number);
}

export function referenceOf(samples: Sample[], analysis: RaceAnalysis, lap: LapFacts, config: CoreConfig): ReferenceAnalysis | null {
  const path = lapPath(samples, lap, analysis.pitStops, config);
  if (path === null) return null;
  return analysisOf(path, lap.timeMs, config);
}

function joinsPath(path: ReferencePath, sample: Sample, config: CoreConfig): boolean {
  return distance(pointAt(path, nearestSM(path, sample.position)).position, sample.position) <= config.match.searchLateralM;
}

function lapRun(samples: Sample[], analysis: RaceAnalysis, lap: LapFacts, path: ReferencePath, config: CoreConfig): LapRun {
  const { samples: inLap, exitRawIndex } = drivenLap(samples, lap, analysis.pitStops, config);
  if (exitRawIndex === null) return { samples: inLap, startSM: undefined };
  const joined = inLap.findIndex(sample => joinsPath(path, sample, config));
  if (joined < 0) return { samples: [], startSM: undefined };
  return { samples: inLap.slice(joined), startSM: nearestSM(path, inLap[joined]!.position) };
}

function shifted(review: Review, index: number, lostMs: number): Review {
  if (index < 0) return review;
  const offsetMs = review.reference.t[index]! + lostMs - review.attempt.t[index]!;
  return { ...review, attempt: { ...review.attempt, t: review.attempt.t.map(value => (value === null ? null : value + offsetMs)) } };
}

function matched(review: Review): number[] {
  return review.attempt.t.flatMap((value, index) => (value === null || review.reference.t[index] === null || review.reference.t[index] === undefined ? [] : [index]));
}

function alignedPitLap(review: Review, compared: LapFacts, withFacts: LapFacts): Review {
  const outLap = compared.pitOut || withFacts.pitOut;
  if (!outLap) return review;
  const cells = matched(review);
  if (compared.pitIn || withFacts.pitIn) return shifted(review, cells[0] ?? -1, 0);
  return shifted(review, cells.at(-1) ?? -1, compared.timeMs - withFacts.timeMs);
}

export function compareLaps(samples: Sample[], analysis: RaceAnalysis, lap: number, withLap: number, exerciseConfig: CoreConfig): LapCompare | null {
  const config = raceCompareConfig(exerciseConfig);
  if (lap === withLap) return null;
  const compared = lapOf(analysis, lap);
  const withFacts = lapOf(analysis, withLap);
  if (!compared || !withFacts) return null;
  const reference = referenceOf(samples, analysis, withFacts, config);
  if (reference === null) return null;
  const run = lapRun(samples, analysis, compared, reference.path, config);
  const built = buildReview(run.samples, reference, config, run.startSM);
  const review = alignedPitLap(built, compared, withFacts);
  return {
    review,
    findings: findDifferences(review, config),
    turnLosses: turnLosses(reference.corners, review.lengthM, review.gridM, review.attempt.t, review.reference.t),
    lapMs: compared.timeMs,
    withMs: withFacts.timeMs
  };
}

export function lapsSpeed(samples: Sample[], analysis: RaceAnalysis, exerciseConfig: CoreConfig): LapsSpeed | null {
  const config = raceCompareConfig(exerciseConfig);
  const referenceLap = lapOf(analysis, analysis.referenceLap);
  const reference = referenceLap ? referenceOf(samples, analysis, referenceLap, config) : null;
  if (reference === null) return null;
  const laps = analysis.laps.map(lap => {
    const run = lapRun(samples, analysis, lap, reference.path, config);
    return { number: lap.number, v: buildReview(run.samples, reference, config, run.startSM).attempt.v };
  });
  return { gridM: config.reviewGridM, lengthM: reference.path.lengthM, turns: turnZones(reference.corners, reference.path.lengthM), laps };
}

export function offTrackView(samples: Sample[], analysis: RaceAnalysis, exerciseConfig: CoreConfig): OffTrackView | null {
  const config = raceCompareConfig(exerciseConfig);
  const referenceLap = lapOf(analysis, analysis.referenceLap);
  const path = referenceLap ? lapPath(samples, referenceLap, analysis.pitStops, config) : null;
  if (path === null) return null;
  const gridM = config.reviewGridM;
  const count = Math.floor(path.lengthM / gridM + 1e-9) + 1;
  const points = Array.from({ length: count }, (_, cell) => pointAt(path, cell * gridM));
  let lowestY = Number.POSITIVE_INFINITY;
  for (const point of path.points) lowestY = Math.min(lowestY, point.position.y);
  const stopAt = (rawIndex: number) => samples.find(sample => sample.rawIndex === rawIndex)?.position;
  const pitLane = analysis.laps.flatMap(lap => {
    const stop = analysis.pitStops.find(candidate => candidate.afterLap === lap.number);
    const stopPosition = stop ? stopAt(stop.stopRawIndex) : undefined;
    const joinSM = lap.pitOut ? lapRun(samples, analysis, lap, path, config).startSM : undefined;
    return [
      ...(joinSM === undefined ? [] : [{ lap: lap.number, fromSM: 0, toSM: joinSM }]),
      ...(stopPosition ? [{ lap: lap.number, fromSM: nearestSM(path, stopPosition), toSM: path.lengthM }] : [])
    ];
  });
  return {
    gridM,
    lengthM: path.lengthM,
    x: points.map(point => point.position.x),
    z: points.map(point => point.position.z),
    heightM: points.map(point => point.position.y - lowestY),
    speedMps: points.map(point => point.speedMps),
    pitLane
  };
}
