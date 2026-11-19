import type { Sample } from '@gt7/contracts';

export type StartWatch = { attemptRunning: boolean; attemptRunEnded: boolean; previousTimerMs: number | null };

export function startMissed(state: StartWatch, sample: Pick<Sample, 'playerSession' | 'gameTimerMs'>): boolean {
  if (state.attemptRunning || state.attemptRunEnded) return false;
  if (!sample.playerSession) return false;
  const previousMs = state.previousTimerMs;
  return previousMs !== null && previousMs > 0 && sample.gameTimerMs > previousMs;
}
