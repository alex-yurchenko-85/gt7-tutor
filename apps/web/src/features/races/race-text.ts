import { counted } from '../../app/plural.ts';

type LapCount = { complete: boolean; firstLap: number; lapsDone: number; lapsInRace: number };

export function lastLap(race: { firstLap: number; lapsDone: number }): number {
  return race.firstLap + race.lapsDone - 1;
}

export function lapsText(race: LapCount): string {
  if (race.complete) return counted(race.lapsDone, 'lap');
  if (race.firstLap === 1) return `${race.lapsDone} of ${race.lapsInRace} laps, not finished`;
  return `laps ${race.firstLap} to ${lastLap(race)} of ${race.lapsInRace}, not finished`;
}

export function positionCaption(firstLap: number, last: number, finished: boolean): string {
  if (finished) return 'position, start to finish';
  if (firstLap === 1) return `position, start to lap ${last}`;
  return `position, laps ${firstLap} to ${last}`;
}
