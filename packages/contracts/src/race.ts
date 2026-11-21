import { z } from 'zod';
import type { CornerReview, Difference, ReviewEvent, ReviewSeries, TurnLossInfo } from './domain.ts';

export type RaceLap = {
  number: number;
  timeMs: number;
  positionStart: number;
  positionEnd: number;
  topSpeedMps: number;
  fuelStart: number;
  fuelEnd: number;
  pitIn: boolean;
  pitOut: boolean;
  closed: boolean;
  offAll: number;
  offPart: number;
};

export type RacePitStop = { afterLap: number; durationMs: number; fuelBefore: number; fuelAfter: number; fromMs: number; toMs: number };

export type RaceOffTrack = {
  lap: number;
  sM: number | null;
  x: number;
  z: number;
  wheels: 2 | 3 | 4;
  durationMs: number;
  speedInMps: number;
  speedMinMps: number;
};

export type RaceRecurringPlace = {
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

export type RaceSummary = {
  id: string;
  trackName: string | null;
  trackCandidates: string[];
  carId: number;
  carName: string | null;
  firstLap: number;
  lapsDone: number;
  lapsInRace: number;
  cars: number;
  startPosition: number;
  finishPosition: number;
  raceMs: number;
  bestLap: number;
  bestLapMs: number;
  pitStops: number;
  offTrack: number;
  complete: boolean;
  startedAt: string;
};

export type RaceDetail = RaceSummary & {
  referenceLap: number;
  lapLengthM: number | null;
  laps: RaceLap[];
  pitStopList: RacePitStop[];
  offTrackList: RaceOffTrack[];
  recurring: RaceRecurringPlace[];
  position: { tMs: number; position: number }[];
  fuel: { tMs: number; fuel: number }[];
};

export type RecordRaceResponse = { captureId: string };

export type StopRaceResponse = { raceId: string | null };

export type LiveRacePhase = 'waiting' | 'grid' | 'joined' | 'lap' | 'finished' | 'stopped';

export type LiveRaceLap = { number: number; timeMs: number; pitAfter: boolean };

export type LiveRace = {
  phase: LiveRacePhase;
  unsupported: boolean;
  lap: number;
  lapsInRace: number;
  firstRecordedLap: number | null;
  position: number;
  startPosition: number | null;
  cars: number;
  lapTimeMs: number;
  lastLapMs: number | null;
  bestLap: number | null;
  bestLapMs: number | null;
  laps: LiveRaceLap[];
  fuel: number;
  fuelLapsLeft: number | null;
  x: number;
  z: number;
  carName: string | null;
  savedRaceId: string | null;
};

export const renameRaceSchema = z.object({ trackName: z.string().trim().min(1).max(80) }).strict();

export type RenameRaceRequest = z.infer<typeof renameRaceSchema>;

export const deleteRacesSchema = z.object({ ids: z.array(z.uuid()).min(1).max(200) }).strict();

export type DeleteRacesRequest = z.infer<typeof deleteRacesSchema>;

export type DeleteRacesResult = { deleted: number };

const lapNumber = z.coerce.number().int().positive();

export const raceCompareQuerySchema = z.object({ lap: lapNumber, with: lapNumber.optional() }).strict();

export type RaceCompareQuery = z.infer<typeof raceCompareQuerySchema>;

export type RaceCompare = {
  lap: number;
  withLap: number;
  lapMs: number;
  withMs: number;
  gridM: number;
  lengthM: number;
  reference: ReviewSeries;
  attempt: ReviewSeries;
  referenceEvents: ReviewEvent[];
  attemptEvents: ReviewEvent[];
  findings: Difference[];
  turnLosses: TurnLossInfo[];
  corners: CornerReview[];
};

export type RaceLapsSpeed = {
  gridM: number;
  lengthM: number;
  turns: { turn: number; fromSM: number; toSM: number }[];
  laps: { number: number; v: (number | null)[] }[];
};

export type RaceDistances = { points: { lap: number; tMs: number; sM: number }[] };

export type RaceOffTrackView = {
  gridM: number;
  lengthM: number;
  x: number[];
  z: number[];
  heightM: number[];
  speedMps: number[];
  pitLane: { lap: number; fromSM: number; toSM: number }[];
  moments: RaceOffTrack[];
  recurring: RaceRecurringPlace[];
};
