import type { GuidanceMode, GuidanceReason, Sample } from '@gt7/contracts';
import type { AttemptEvent } from './attempts.ts';
import type { CoachSettings, SuppressReason } from './coach.ts';
import type { CoreConfig } from './config.ts';
import type { ReferenceAnalysis } from './reference-analysis.ts';
import { TrainingRun } from './training-run.ts';

export type ReplayOptions = CoachSettings & {
  deviceDelayMs: number;
  phraseMs: (clip: string) => number;
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
  analysis: ReferenceAnalysis,
  config: CoreConfig,
  options: ReplayOptions
): CoachTrace {
  const { deviceDelayMs, phraseMs, ...settings } = options;
  let generations = 0;
  const run = new TrainingRun(analysis, config, settings, { guided: true, nextGeneration: () => ++generations });
  const trace: CoachTrace = { attemptEvents: [], cues: [], suppressed: [], guidance: [] };
  let lastGuidance = '';
  for (const sample of samples) {
    const step = run.step(sample, { deviceDelayMs, phraseMs });
    for (const event of step.attemptEvents) {
      trace.attemptEvents.push({ generation: event.generation, type: event.type, rawIndex: event.rawIndex, reason: event.reason });
      if (event.type === 'started') lastGuidance = '';
    }
    if (run.state !== 'driving' && run.state !== 'paused') continue;
    const { generation } = run;
    if (step.cue) {
      const { id, kind, targetSpeedKph, clip, followClip, priority, decidedMonoMs, ttlMs } = step.cue;
      const sM = step.match ? Math.round(step.match.sM * 100) / 100 : null;
      trace.cues.push({ id, kind, targetSpeedKph, clip, followClip, priority, rawIndex: sample.rawIndex, sM, decidedMonoMs: Math.round(decidedMonoMs), ttlMs: Math.round(ttlMs) });
    }
    for (const { eventKey, why } of step.suppressed) trace.suppressed.push({ generation, eventKey, why, rawIndex: sample.rawIndex });
    const key = `${step.guidance.mode}:${step.guidance.reason}`;
    if (key !== lastGuidance) trace.guidance.push({ generation, rawIndex: sample.rawIndex, ...step.guidance });
    lastGuidance = key;
  }
  return trace;
}
