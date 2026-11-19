import type { Match } from './match.ts';

export function gapToReferenceMs(match: Pick<Match, 'reference'>, gameTimerMs: number): number {
  return gameTimerMs - match.reference.timerMs;
}
