import { describe, expect, it } from 'vitest';
import { replayCoach } from '../src/coach-replay.ts';
import type { CoachSettings } from '../src/coach.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { buildCueEvents } from '../src/cue-events.ts';
import { cueText, estimatedPhraseMs } from '../src/cue-text.ts';
import { TrainingRun } from '../src/training-run.ts';
import { between, samplesOf, type FixtureName } from './fixtures.ts';
import { analysisOf, interlagosReference } from './paths.ts';

const FIXTURES: FixtureName[] = ['b1-run', 'b3-run', 'ce-clean', 'ce-off-track-end', 'ce-off-track-reset', 'ce-pause', 'ce-slow', 'demo-a', 'demo-b', 'demo-c'];

const settings: CoachSettings = { mutedKeys: new Set(['ease-off@564']), speakTargets: true, offsetsMs: new Map([['brake@291', 200]]), sideCueDistanceM: 1 };

const now = { deviceDelayMs: 60, phraseMs: estimatedPhraseMs };

function counter(): () => number {
  let generation = 0;
  return () => ++generation;
}

describe('TrainingRun', () => {
  const path = interlagosReference();
  const events = buildCueEvents(path, DEFAULT_CONFIG);
  const analysis = analysisOf(path, events);

  it('training_run_matches_replay_coach_on_every_fixture', () => {
    let spoken = 0;
    for (const name of FIXTURES) {
      const samples = samplesOf(name);
      const run = new TrainingRun(analysis, DEFAULT_CONFIG, settings, { guided: true, nextGeneration: counter() });
      const attempts: unknown[] = [];
      const cues: unknown[] = [];
      const suppressed: unknown[] = [];
      for (const sample of samples) {
        const step = run.step(sample, now);
        for (const event of step.attemptEvents) attempts.push({ generation: event.generation, type: event.type, rawIndex: event.rawIndex, reason: event.reason });
        if (step.cue) cues.push({ id: step.cue.id, clip: step.cue.clip, followClip: step.cue.followClip, rawIndex: sample.rawIndex, sM: step.match ? Math.round(step.match.sM * 100) / 100 : null, decidedMonoMs: Math.round(step.cue.decidedMonoMs) });
        for (const entry of step.suppressed) suppressed.push({ generation: run.generation, eventKey: entry.eventKey, why: entry.why, rawIndex: sample.rawIndex });
      }
      const trace = replayCoach(samples, analysis, DEFAULT_CONFIG, { ...settings, ...now });
      expect(attempts, name).toEqual(trace.attemptEvents);
      expect(cues, name).toEqual(trace.cues.map(({ id, clip, followClip, rawIndex, sM, decidedMonoMs }) => ({ id, clip, followClip, rawIndex, sM, decidedMonoMs })));
      expect(suppressed, name).toEqual(trace.suppressed);
      spoken += cues.length;
    }
    expect(spoken).toBeGreaterThan(20);
  });

  it('training_run_without_guidance_gives_position_and_gap_but_no_cue', () => {
    const samples = between(samplesOf('ce-slow'), 5400, 6624);
    const run = new TrainingRun(analysis, DEFAULT_CONFIG, settings, { guided: false, nextGeneration: counter() });
    const steps = samples.map(sample => ({ sample, step: run.step(sample, now) }));
    const driving = steps.filter(entry => entry.step.match !== null);
    expect(driving.length).toBeGreaterThan(500);
    expect(steps.every(entry => entry.step.cue === null && entry.step.suppressed.length === 0)).toBe(true);
    expect(steps.every(entry => entry.step.guidance.mode === 'active' && entry.step.guidance.reason === null)).toBe(true);
    for (const { sample, step } of driving.filter(entry => entry.sample.gameTimerMs > 0)) {
      expect(step.gapMs).toBeCloseTo(sample.gameTimerMs - step.match!.reference.timerMs, 6);
    }
    const first = driving[0]!.step;
    const next = events.find(event => event.sM > first.match!.sM && !settings.mutedKeys.has(event.key) && cueText(event.voice))!;
    expect(first.nextCue).toEqual({ text: cueText(next.voice), inM: next.sM - first.match!.sM });
  });

  it('next_cue_is_the_first_unmuted_cue_ahead_also_after_a_restart', () => {
    const session = [samplesOf('ce-off-track-reset'), samplesOf('ce-clean'), samplesOf('ce-pause'), samplesOf('ce-off-track-end')].reduce((all, next) =>
      all.concat(next.filter(sample => sample.rawIndex > all.at(-1)!.rawIndex))
    );
    const shuffled = analysisOf(path, [...events].reverse());
    for (const reference of [analysis, shuffled]) {
      const run = new TrainingRun(reference, DEFAULT_CONFIG, settings, { guided: false, nextGeneration: counter() });
      let jumpsBack = 0;
      let previousSM: number | null = null;
      for (const sample of session) {
        const step = run.step(sample, now);
        if (!step.match) continue;
        if (previousSM !== null && step.match.sM < previousSM - 50) jumpsBack += 1;
        previousSM = step.match.sM;
        const next = reference.events.find(event => event.sM > step.match!.sM && !settings.mutedKeys.has(event.key) && cueText(event.voice));
        expect(step.nextCue, String(sample.rawIndex)).toEqual(next ? { text: cueText(next.voice), inM: next.sM - step.match.sM } : null);
      }
      expect(jumpsBack).toBeGreaterThanOrEqual(3);
    }
  });

  it('training_run_start_samples_hold_the_sample_before_the_start', () => {
    const samples = samplesOf('ce-slow');
    const run = new TrainingRun(analysis, DEFAULT_CONFIG, settings, { guided: true, nextGeneration: () => 7 });
    let previous: (typeof samples)[number] | null = null;
    for (const sample of samples) {
      const step = run.step(sample, now);
      if (step.attemptEvents.some(event => event.type === 'started')) {
        expect(step.startSamples).toEqual([previous, sample]);
        expect(run.generation).toBe(7);
        expect(run.state).toBe('driving');
        expect(run.abortByUser(sample.receivedMonoMs + 1)).toMatchObject([{ type: 'aborted', reason: 'manual' }]);
        expect(run.state).toBe('waiting');
        expect(run.tick(sample.receivedMonoMs + 10_000)).toEqual([]);
        return;
      }
      expect(step.startSamples).toEqual([]);
      previous = sample;
    }
    throw new Error('ce-slow has no start');
  });
});
