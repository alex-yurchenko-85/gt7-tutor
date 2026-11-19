import type { Sample, StartKindName } from '@gt7/contracts';
import type { CoreConfig } from './config.ts';
import { findCorners, type Corner } from './corners.ts';
import { buildCueEvents, type ReferenceCueEvent } from './cue-events.ts';
import { buildReference, type ReferencePath } from './reference.ts';

export type ReferenceAnalysis = { path: ReferencePath; events: ReferenceCueEvent[]; corners: Corner[]; timeMs: number };

export function analyseReference(samples: Sample[], startKind: StartKindName, config: CoreConfig): ReferenceAnalysis {
  const path = buildReference(samples, startKind, config);
  const events = buildCueEvents(path, config);
  return { path, events, corners: findCorners(path, events, config), timeMs: samples.at(-1)!.gameTimerMs };
}
