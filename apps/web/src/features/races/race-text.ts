import { t } from '../../app/i18n.ts';

type LapCount = { complete: boolean; firstLap: number; lapsDone: number; lapsInRace: number };

export function lastLap(race: { firstLap: number; lapsDone: number }): number {
  return race.firstLap + race.lapsDone - 1;
}

export function lapsText(race: LapCount): string {
  if (race.complete) return t('races.laps', { count: race.lapsDone });
  if (race.firstLap === 1) return t('races.laps.partial', { done: race.lapsDone, count: race.lapsInRace });
  return t('races.laps.cut', { first: race.firstLap, last: lastLap(race), count: race.lapsInRace });
}

export function positionCaption(firstLap: number, last: number, finished: boolean): string {
  if (finished) return t('races.position.finished');
  if (firstLap === 1) return t('races.position.to-lap', { lap: last });
  return t('races.position.laps', { first: firstLap, last });
}
