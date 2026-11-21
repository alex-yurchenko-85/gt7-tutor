import type { Sample } from '@gt7/contracts';
import type { CoreConfig } from './config.ts';
import { findCorners, type Corner } from './corners.ts';
import { buildCueEvents, type ReferenceCueEvent } from './cue-events.ts';
import { buildReference, type ReferencePath } from './reference.ts';

export type ReferenceAnalysis = { path: ReferencePath; events: ReferenceCueEvent[]; corners: Corner[]; timeMs: number };

export function analyseReference(samples: Sample[], config: CoreConfig): ReferenceAnalysis {
  return analysisOf(buildReference(samples, config), samples.at(-1)!.gameTimerMs, config);
}

export function analysisOf(path: ReferencePath, timeMs: number, config: CoreConfig): ReferenceAnalysis {
  const events = buildCueEvents(path, config);
  return { path, events, corners: findCorners(path, events, config), timeMs };
}
