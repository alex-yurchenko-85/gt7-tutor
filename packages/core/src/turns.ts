import { cornerAt, type Corner } from './corners.ts';

export type TurnLoss = { turn: number; fromSM: number; toSM: number; lostMs: number | null };

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

function zoneGaps(zone: TurnZone, gridM: number, attemptT: (number | null)[], referenceT: (number | null)[]): number[] {
  const gaps: number[] = [];
  const first = Math.ceil(zone.fromSM / gridM);
  const last = Math.floor(zone.toSM / gridM);
  for (let index = first; index <= last; index += 1) {
    const gap = gapAt(attemptT, referenceT, index);
    if (gap !== null) gaps.push(gap);
  }
  return gaps;
}

export function turnLosses(
  corners: Corner[],
  lengthM: number,
  gridM: number,
  attemptT: (number | null)[],
  referenceT: (number | null)[]
): TurnLoss[] {
  return turnZones(corners, lengthM).map(zone => {
    const gaps = zoneGaps(zone, gridM, attemptT, referenceT);
    const lostMs = gaps.length < 2 ? null : gaps[gaps.length - 1]! - gaps[0]!;
    return { ...zone, lostMs };
  });
}
