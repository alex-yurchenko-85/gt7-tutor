import type { Sample } from '@gt7/contracts';
import { AttemptTracker } from './attempts.ts';
import { DEFAULT_CONFIG, type CoreConfig } from './config.ts';
import type { ReferencePath } from './reference.ts';

export function measureAttemptMs(samples: Sample[], path: ReferencePath, config: CoreConfig = DEFAULT_CONFIG): number | null {
  const tracker = new AttemptTracker({ start: path.start, end: path.end, startKind: path.startKind }, config);
  let startedAt: number | null = null;
  let pausedAt: number | null = null;
  let pausedMs = 0;
  for (const sample of samples) {
    for (const event of tracker.step(sample)) {
      if (event.type === 'started') {
        startedAt = event.atMonoMs;
        pausedAt = null;
        pausedMs = 0;
      } else if (event.type === 'paused') {
        pausedAt = event.atMonoMs;
      } else if (event.type === 'resumed' && pausedAt !== null) {
        pausedMs += event.atMonoMs - pausedAt;
        pausedAt = null;
      } else if (event.type === 'aborted') {
        startedAt = null;
      } else if (event.type === 'finished' && startedAt !== null) {
        return event.atMonoMs - startedAt - pausedMs;
      }
    }
  }
  return null;
}
