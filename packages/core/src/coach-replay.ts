import type { Sample } from '@gt7/contracts';
import { AttemptTracker, type AttemptEvent } from './attempts.ts';
import { Coach, type SuppressReason } from './coach.ts';
import type { CoreConfig } from './config.ts';
import type { ReferenceCueEvent } from './cue-events.ts';
import type { GuidanceMode, GuidanceReason } from './guidance.ts';
import { Matcher } from './match.ts';
import type { ReferencePath } from './reference.ts';

export type ReplayOptions = {
  deviceDelayMs: number;
  phraseMs: (clip: string) => number;
  mutedKeys: ReadonlySet<string>;
  speakTargets: boolean;
  offsetsMs: ReadonlyMap<string, number>;
  sideCueDistanceM: number | null;
};

export type TraceAttempt = { generation: number; type: AttemptEvent['type']; rawIndex: number | null; reason: string | null };

export type TraceCue = {
  id: string;
  kind: string;
  targetSpeedKph: number | null;
  clip: string;
  followClip: string | null;
  priority: number;
  rawIndex: number;
  sM: number | null;
  decidedMonoMs: number;
  ttlMs: number;
};

export type TraceSuppressed = { generation: number; eventKey: string; why: SuppressReason; rawIndex: number };

export type TraceGuidance = { generation: number; rawIndex: number; mode: GuidanceMode; reason: GuidanceReason };

export type CoachTrace = {
  attemptEvents: TraceAttempt[];
  cues: TraceCue[];
  suppressed: TraceSuppressed[];
  guidance: TraceGuidance[];
};

export function replayCoach(
  samples: Sample[],
  path: ReferencePath,
  events: ReferenceCueEvent[],
  config: CoreConfig,
  options: ReplayOptions
): CoachTrace {
  const tracker = new AttemptTracker(config);
  const matcher = new Matcher(path, config);
  const coach = new Coach(path, events, config);
  const trace: CoachTrace = { attemptEvents: [], cues: [], suppressed: [], guidance: [] };
  let generation = 0;
  let lastGuidance = '';
  for (const sample of samples) {
    for (const event of tracker.step(sample)) {
      trace.attemptEvents.push({ generation: event.generation, type: event.type, rawIndex: event.rawIndex, reason: event.reason });
      if (event.type !== 'started') continue;
      generation = event.generation;
      matcher.reset();
      coach.reset(generation);
      lastGuidance = '';
    }
    if (tracker.state !== 'driving' && tracker.state !== 'paused') continue;
    const match = matcher.step(sample);
    const output = coach.step({ sample, match, nowMonoMs: sample.receivedMonoMs, generation, ...options });
    if (output.cue) {
      const { id, kind, targetSpeedKph, clip, followClip, priority, decidedMonoMs, ttlMs } = output.cue;
      const sM = match?.sM ?? null;
      trace.cues.push({ id, kind, targetSpeedKph, clip, followClip, priority, rawIndex: sample.rawIndex, sM, decidedMonoMs, ttlMs });
    }
    for (const entry of output.suppressed) trace.suppressed.push({ generation, ...entry, rawIndex: sample.rawIndex });
    const key = `${output.guidance.mode}:${output.guidance.reason}`;
    if (key !== lastGuidance) trace.guidance.push({ generation, rawIndex: sample.rawIndex, ...output.guidance });
    lastGuidance = key;
  }
  return trace;
}
