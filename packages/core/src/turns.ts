import type { FocusPart } from '@gt7/contracts';
import type { Review } from './compare.ts';
import { cornerAt, type Corner } from './corners.ts';

export type TurnPartLosses = Record<FocusPart, number | null>;

export type TurnLoss = { turn: number; fromSM: number; toSM: number; entrySM: number; exitSM: number; lostMs: number | null; parts: TurnPartLosses };

export type TurnZone = { turn: number; fromSM: number; toSM: number };

export function turnOf(corners: Corner[], sM: number): number | null {
  return cornerAt(corners, sM)?.number ?? null;
}

export function turnZones(corners: Corner[], lengthM: number): TurnZone[] {
  return corners.map((corner, index) => ({
    turn: corner.number,
    fromSM: corner.turnInSM,
    toSM: Math.min(corner.apexSM + (corner.apexSM - corner.turnInSM), corners[index + 1]?.turnInSM ?? lengthM, lengthM)
  }));
}

function gapAt(attemptT: (number | null)[], referenceT: (number | null)[], index: number): number | null {
  const attempt = attemptT[index];
  const reference = referenceT[index];
  if (attempt === null || attempt === undefined || reference === null || reference === undefined) return null;
  return attempt - reference;
}

function lossRanges(corners: Corner[], lengthM: number): TurnZone[] {
  return corners.map((corner, index) => ({
    turn: corner.number,
    fromSM: index === 0 ? 0 : corner.zoneStartSM,
    toSM: corners[index + 1]?.zoneStartSM ?? lengthM
  }));
}

function cellOf(sM: number, gridM: number, count: number): number {
  return Math.max(0, Math.min(count - 1, Math.round(sM / gridM)));
}

function partLosses(range: TurnZone, entrySM: number, exitSM: number, gridM: number, carried: (number | null)[]): TurnPartLosses {
  const [start, turnIn, apex, end] = [range.fromSM, entrySM, exitSM, range.toSM].map(sM => carried[cellOf(sM, gridM, carried.length)]!);
  return { approach: turnIn! - start!, entry: apex! - turnIn!, exit: end! - apex! };
}

export function turnLosses(
  corners: Corner[],
  lengthM: number,
  gridM: number,
  attemptT: (number | null)[],
  referenceT: (number | null)[]
): TurnLoss[] {
  const gaps = attemptT.map((_, index) => gapAt(attemptT, referenceT, index));
  const first = gaps.findIndex(gap => gap !== null);
  const carried: (number | null)[] = [];
  let known: number | null = first < 0 ? null : gaps[first]!;
  for (const gap of gaps) {
    if (gap !== null) known = gap;
    carried.push(known);
  }
  return lossRanges(corners, lengthM).map((range, index) => {
    const from = cellOf(range.fromSM, gridM, gaps.length);
    const to = cellOf(range.toSM, gridM, gaps.length);
    let matched = false;
    for (let cell = index === 0 ? from : from + 1; cell <= to && !matched; cell++) matched = (gaps[cell] ?? null) !== null;
    const lostMs = matched ? carried[to]! - carried[from]! : null;
    const clamped = (sM: number) => Math.max(range.fromSM, Math.min(range.toSM, sM));
    const entrySM = clamped(corners[index]!.turnInSM);
    const exitSM = clamped(corners[index]!.apexSM);
    return { ...range, entrySM, exitSM, lostMs, parts: lostMs === null ? { approach: null, entry: null, exit: null } : partLosses(range, entrySM, exitSM, gridM, carried) };
  });
}

export function reviewLosses(review: Review, corners: Corner[] = review.corners): TurnLoss[] {
  return turnLosses(corners, review.lengthM, review.gridM, review.attempt.t, review.reference.t);
}
