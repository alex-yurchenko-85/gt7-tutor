import type { RaceDetail, RaceDistances } from '@gt7/contracts';
import { groupedMetres as metres } from '../../app/format.ts';

export type DistancePoint = RaceDistances['points'][number];

type CursorFacts = { lap: number; sM: number | null; position: number; from: number | null; fuel: number | null };

function lapAt(race: RaceDetail, tMs: number): number {
  let endMs = 0;
  for (const lap of race.laps) {
    endMs += lap.timeMs;
    if (tMs < endMs) return lap.number;
  }
  return race.laps.at(-1)?.number ?? race.firstLap;
}

function interpolated<T extends { tMs: number }>(points: T[], tMs: number, value: (point: T) => number): number | null {
  if (points.length === 0) return null;
  const after = points.findIndex(point => point.tMs >= tMs);
  if (after < 0) return value(points.at(-1)!);
  if (after === 0) return value(points[0]!);
  const a = points[after - 1]!;
  const b = points[after]!;
  const share = b.tMs > a.tMs ? (tMs - a.tMs) / (b.tMs - a.tMs) : 1;
  return value(a) + (value(b) - value(a)) * share;
}

export function positionChanges(race: RaceDetail): number[] {
  return race.position.slice(1).map(step => step.tMs);
}

export function cursorFacts(race: RaceDetail, points: DistancePoint[] | null, tMs: number): CursorFacts {
  const lap = lapAt(race, tMs);
  const index = race.position.findLastIndex(step => step.tMs <= tMs);
  const step = race.position[Math.max(0, index)];
  const changed = index > 0 && step !== undefined && step.tMs === tMs;
  return {
    lap,
    sM: points === null ? null : interpolated(points.filter(point => point.lap === lap), tMs, point => point.sM),
    position: step?.position ?? race.startPosition,
    from: changed ? race.position[index - 1]!.position : null,
    fuel: interpolated(race.fuel, tMs, point => point.fuel)
  };
}

function placeText(facts: CursorFacts): string {
  return facts.sM === null ? `Lap ${facts.lap}` : `Lap ${facts.lap} · ${metres(facts.sM)}`;
}

export function positionBox(facts: CursorFacts): string[] {
  return [placeText(facts), `Position ${facts.position}`, ...(facts.from === null ? [] : [`${facts.from} → ${facts.position} here`])];
}

export function fuelBox(facts: CursorFacts): string[] {
  return [placeText(facts), facts.fuel === null ? 'Fuel: no data' : `Fuel ${Math.round(facts.fuel)}`];
}

export function cursorSentence(facts: CursorFacts): string {
  const place = facts.sM === null ? `lap ${facts.lap}` : `lap ${facts.lap}, ${metres(facts.sM)}`;
  const change = facts.from === null ? '' : `, ${facts.position < facts.from ? 'up' : 'down'} from ${facts.from}`;
  return `Cursor at ${place}: position ${facts.position}${change}.`;
}
