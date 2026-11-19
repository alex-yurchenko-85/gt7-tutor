import type { Sample } from '@gt7/contracts';
import { AttemptTracker } from './attempts.ts';
import { DEFAULT_CONFIG, type CoreConfig } from './config.ts';
import { pointAt, type ReferencePath } from './reference.ts';

export type AttemptTimes = { measuredMs: number | null; gameMs: number | null };

const NO_TIMES: AttemptTimes = { measuredMs: null, gameMs: null };

export function measureAttemptTimes(samples: Sample[], config: CoreConfig = DEFAULT_CONFIG): AttemptTimes {
  const tracker = new AttemptTracker(config);
  let startedAt: number | null = null;
  let pausedAt: number | null = null;
  let pausedMs = 0;
  for (const sample of samples) {
    for (const event of tracker.step(sample)) {
      if (event.type === 'started') {
        startedAt = event.atClockMs;
        pausedAt = null;
        pausedMs = 0;
      } else if (event.type === 'paused') {
        pausedAt = event.atClockMs;
      } else if (event.type === 'resumed' && pausedAt !== null) {
        pausedMs += event.atClockMs - pausedAt;
        pausedAt = null;
      } else if (event.type === 'aborted') {
        startedAt = null;
      } else if (event.type === 'finished' && startedAt !== null) {
        return { measuredMs: event.atClockMs - startedAt - pausedMs, gameMs: event.gameTimeMs };
      }
    }
  }
  return NO_TIMES;
}

export function gapToReferenceMs(path: ReferencePath, sM: number, gameTimerMs: number): number {
  return gameTimerMs - pointAt(path, sM).timerMs;
}
