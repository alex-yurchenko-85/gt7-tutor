import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readSamples } from '@gt7/capture';
import type { Sample } from '@gt7/contracts';
import { DEFAULT_CONFIG, analyseReference, estimatedPhraseMs, replayCoach, type Cue } from '@gt7/core';
import { TrainingSession, type AttemptRecord, type TrainingEffects } from '../src/training/training-session.js';

const CE_CLEAN = fileURLToPath(new URL('../../../fixtures/ce-clean.ndjson', import.meta.url));
const CE_SLOW = fileURLToPath(new URL('../../../fixtures/ce-slow.ndjson', import.meta.url));
const DEMO_A = fileURLToPath(new URL('../../../fixtures/demo-a.ndjson', import.meta.url));

function recordingEffects(records: AttemptRecord[]): TrainingEffects {
  let generation = 0;
  return {
    deviceDelayMs: () => 0,
    phraseMs: () => 0,
    nextGeneration: () => ++generation,
    sendCue: () => false,
    cancel: () => undefined,
    attemptEnded: record => records.push(record),
    changed: () => undefined
  };
}

describe('TrainingSession', () => {
  it('finished_attempt_range_keeps_the_game_timer_finish', async () => {
    const samples = await readSamples(CE_CLEAN);
    const analysis = analyseReference(samples.filter(sample => sample.rawIndex >= 8452 && sample.rawIndex <= 9476), DEFAULT_CONFIG);
    const records: AttemptRecord[] = [];
    const session = new TrainingSession(
      {
        userId: 'user',
        exerciseId: 'exercise',
        referenceId: 'reference',
        analysis: { ...analysis, events: [], corners: [] },
        mutedKeys: new Set(),
        speakTargets: false,
        offsetsMs: new Map(),
        sideCueDistanceM: null,
        storedAttempts: 0
      },
      DEFAULT_CONFIG,
      recordingEffects(records)
    );
    for (const sample of samples) session.onSample(sample);
    expect(records).toHaveLength(1);
    const [record] = records;
    expect(record).toMatchObject({ completion: 'complete', reason: 'game-timer', firstRawIndex: 8451, lastRawIndex: 9479, gameTimeMs: 17071 });
  });

  it('live_session_and_replay_give_the_same_trace', async () => {
    const analysis = analyseReference(await readSamples(DEMO_A, { first: 457, last: 1422 }), DEFAULT_CONFIG);
    const settings = { mutedKeys: new Set(['throttle@411']), speakTargets: false, offsetsMs: new Map([['ease-off@564', 150]]), sideCueDistanceM: 1 };
    const samples = await readSamples(CE_SLOW);
    const sent: { id: string; kind: string; clip: string; followClip: string | null; rawIndex: number; decidedMonoMs: number }[] = [];
    let current: Sample | null = null;
    let generation = 0;
    const session = new TrainingSession(
      { userId: 'user', exerciseId: 'exercise', referenceId: 'reference', analysis, storedAttempts: 0, ...settings },
      DEFAULT_CONFIG,
      {
        deviceDelayMs: () => 60,
        phraseMs: estimatedPhraseMs,
        nextGeneration: () => ++generation,
        sendCue: (cue: Cue) =>
          sent.push({ id: cue.id, kind: cue.kind, clip: cue.clip, followClip: cue.followClip, rawIndex: current!.rawIndex, decidedMonoMs: Math.round(cue.decidedMonoMs) }) > 0,
        cancel: () => undefined,
        attemptEnded: () => undefined,
        changed: () => undefined
      }
    );
    for (const sample of samples) {
      current = sample;
      session.onSample(sample);
    }
    const trace = replayCoach(samples, analysis, DEFAULT_CONFIG, { ...settings, deviceDelayMs: 60, phraseMs: estimatedPhraseMs });
    expect(sent.length).toBeGreaterThan(4);
    expect(trace.suppressed.some(item => item.eventKey === 'throttle@411' && item.why === 'muted')).toBe(true);
    expect(trace.cues.some(cue => cue.id === '1:throttle@411')).toBe(false);
    expect(trace.cues.every(cue => cue.followClip === null)).toBe(true);
    expect(sent).toEqual(
      trace.cues.map(cue => ({ id: cue.id, kind: cue.kind, clip: cue.clip, followClip: cue.followClip, rawIndex: cue.rawIndex, decidedMonoMs: cue.decidedMonoMs }))
    );
  });
  it('standing_car_sends_no_state_changes', async () => {
    const samples = await readSamples(CE_CLEAN);
    const analysis = analyseReference(samples.filter(sample => sample.rawIndex >= 8452 && sample.rawIndex <= 9476), DEFAULT_CONFIG);
    let changes = 0;
    const session = new TrainingSession(
      { userId: 'user', exerciseId: 'exercise', referenceId: 'reference', analysis, mutedKeys: new Set(), speakTargets: false, offsetsMs: new Map(), sideCueDistanceM: null, storedAttempts: 0 },
      DEFAULT_CONFIG,
      { ...recordingEffects([]), changed: () => void changes++ }
    );
    const standing = { ...samples[0]!, speedMps: 0, gameTimerMs: 0 };
    for (let index = 0; index < 100; index++) session.onSample({ ...standing, rawIndex: standing.rawIndex + index, receivedMonoMs: standing.receivedMonoMs + index * 16 });
    expect(changes).toBe(1);
    session.onSample({ ...standing, rawIndex: standing.rawIndex + 100, speedMps: 5 });
    expect(changes).toBe(2);
  });

  it('cue_records_of_old_generations_are_dropped', async () => {
    const analysis = analyseReference(await readSamples(DEMO_A, { first: 457, last: 1422 }), DEFAULT_CONFIG);
    const samples = await readSamples(CE_SLOW);
    const sentIds: string[] = [];
    let generation = 0;
    const session = new TrainingSession(
      { userId: 'user', exerciseId: 'exercise', referenceId: 'reference', analysis, mutedKeys: new Set(), speakTargets: false, offsetsMs: new Map(), sideCueDistanceM: 1, storedAttempts: 0 },
      DEFAULT_CONFIG,
      {
        ...recordingEffects([]),
        deviceDelayMs: () => 60,
        phraseMs: estimatedPhraseMs,
        nextGeneration: () => ++generation,
        sendCue: (cue: Cue) => sentIds.push(cue.id) > 0
      }
    );
    const first = samples[0]!;
    const last = samples.at(-1)!;
    const span = last.receivedMonoMs - first.receivedMonoMs + 10000;
    const idsByRound: string[][] = [];
    for (let round = 0; round < 3; round++) {
      const before = sentIds.length;
      for (const sample of samples) {
        session.onSample({ ...sample, rawIndex: sample.rawIndex + round * 1_000_000, receivedMonoMs: sample.receivedMonoMs + round * span });
      }
      idsByRound.push(sentIds.slice(before));
    }
    expect(generation).toBe(3);
    expect(idsByRound.every(ids => ids.length > 0)).toBe(true);
    expect(session.recordOutcome(idsByRound[0]![0]!, 'played', 10)).toBeNull();
    expect(session.recordOutcome(idsByRound[1]![0]!, 'played', 10)).not.toBeNull();
    expect(session.recordOutcome(idsByRound[2]![0]!, 'played', 10)).not.toBeNull();
  });

  it('live_state_shows_a_missed_start_while_the_timer_runs_without_an_attempt', async () => {
    const samples = await readSamples(CE_SLOW);
    const analysis = analyseReference(await readSamples(DEMO_A, { first: 457, last: 1422 }), DEFAULT_CONFIG);
    let changes = 0;
    const session = new TrainingSession(
      { userId: 'user', exerciseId: 'exercise', referenceId: 'reference', analysis, mutedKeys: new Set(), speakTargets: false, offsetsMs: new Map(), sideCueDistanceM: null, storedAttempts: 0 },
      DEFAULT_CONFIG,
      { ...recordingEffects([]), changed: () => void changes++ }
    );
    const missed: number[] = [];
    for (const sample of samples.filter(item => item.rawIndex >= 6000)) {
      const before = changes;
      session.onSample(sample);
      if (session.state.startMissed) missed.push(sample.rawIndex);
      if (sample.rawIndex === 6001) expect(changes, String(sample.rawIndex)).toBe(before + 1);
    }
    expect(session.state.mode).toBe('armed');
    expect([missed[0], missed.at(-1), missed.length]).toEqual([6001, 6621, 621]);
  });
});
