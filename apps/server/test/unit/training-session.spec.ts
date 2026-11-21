import { describe, expect, it } from 'vitest';
import { readSamples } from '@gt7/capture';
import { ENGLISH, type Sample } from '@gt7/contracts';
import { DEFAULT_CONFIG, analyseReference, estimatedPhraseMs, replayCoach, type Cue, type ReferenceAnalysis } from '@gt7/core';
import { TrainingSession, type AttemptRecord, type TrainingEffects } from '../../src/training/training-session.js';
import { fixturePath } from '../../../../tools/testing/fixture-path.js';

const englishPhraseMs = (clip: string) => estimatedPhraseMs(ENGLISH, clip);

const DEMONSTRATION = { first: 457, last: 1422 };
const DEMONSTRATION_TIMER_MS = 16082;

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

type SessionSettings = Pick<ConstructorParameters<typeof TrainingSession>[0], 'mutedKeys' | 'speakTargets' | 'offsetsMs' | 'sideCueDistanceM'>;

function sessionOf(analysis: ReferenceAnalysis, effects: TrainingEffects, settings: Partial<SessionSettings> = {}): TrainingSession {
  return new TrainingSession(
    {
      userId: 'user',
      exerciseId: 'exercise',
      referenceId: 'reference',
      analysis,
      mutedKeys: new Set(),
      speakTargets: false,
      offsetsMs: new Map(),
      sideCueDistanceM: null,
      storedAttempts: 0,
      ...settings
    },
    DEFAULT_CONFIG,
    effects
  );
}

async function demonstration(): Promise<ReferenceAnalysis> {
  return analyseReference(await readSamples(fixturePath('demo-a'), DEMONSTRATION), DEFAULT_CONFIG);
}

async function cleanRunReference(samples: Sample[]): Promise<ReferenceAnalysis> {
  return analyseReference(samples.filter(sample => sample.rawIndex >= 8452 && sample.rawIndex <= 9476), DEFAULT_CONFIG);
}

describe('TrainingSession', () => {
  it('finished_attempt_range_keeps_the_game_timer_finish', async () => {
    const samples = await readSamples(fixturePath('ce-clean'));
    const analysis = await cleanRunReference(samples);
    const records: AttemptRecord[] = [];
    const session = sessionOf({ ...analysis, events: [], corners: [] }, recordingEffects(records));
    for (const sample of samples) session.onSample(sample);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ completion: 'complete', reason: 'game-timer', firstRawIndex: 8451, lastRawIndex: 9479, gameTimeMs: 17071 });
  });

  it('live_session_and_replay_give_the_same_trace', async () => {
    const analysis = await demonstration();
    const settings = { mutedKeys: new Set(['throttle@411']), speakTargets: false, offsetsMs: new Map([['ease-off@564', 150]]), sideCueDistanceM: 1 };
    const samples = await readSamples(fixturePath('ce-slow'));
    const sent: { id: string; kind: string; clip: string; followClip: string | null; rawIndex: number; decidedMonoMs: number }[] = [];
    let current: Sample | null = null;
    const session = sessionOf(
      analysis,
      {
        ...recordingEffects([]),
        deviceDelayMs: () => 60,
        phraseMs: englishPhraseMs,
        sendCue: (cue: Cue) =>
          sent.push({ id: cue.id, kind: cue.kind, clip: cue.clip, followClip: cue.followClip, rawIndex: current!.rawIndex, decidedMonoMs: Math.round(cue.decidedMonoMs) }) > 0
      },
      settings
    );
    for (const sample of samples) {
      current = sample;
      session.onSample(sample);
    }
    const trace = replayCoach(samples, analysis, DEFAULT_CONFIG, { ...settings, deviceDelayMs: 60, phraseMs: englishPhraseMs });
    expect(sent.length).toBeGreaterThan(4);
    expect(trace.suppressed.some(item => item.eventKey === 'throttle@411' && item.why === 'muted')).toBe(true);
    expect(trace.cues.some(cue => cue.id === '1:throttle@411')).toBe(false);
    expect(trace.cues.every(cue => cue.followClip === null)).toBe(true);
    expect(sent).toEqual(
      trace.cues.map(cue => ({ id: cue.id, kind: cue.kind, clip: cue.clip, followClip: cue.followClip, rawIndex: cue.rawIndex, decidedMonoMs: cue.decidedMonoMs }))
    );
  });

  it('standing_car_sends_no_state_changes', async () => {
    const samples = await readSamples(fixturePath('ce-clean'));
    let changes = 0;
    const session = sessionOf(await cleanRunReference(samples), { ...recordingEffects([]), changed: () => void changes++ });
    const standing = { ...samples[0]!, speedMps: 0, gameTimerMs: 0 };
    for (let index = 0; index < 100; index++) session.onSample({ ...standing, rawIndex: standing.rawIndex + index, receivedMonoMs: standing.receivedMonoMs + index * 16 });
    expect(changes).toBe(1);
    session.onSample({ ...standing, rawIndex: standing.rawIndex + 100, speedMps: 5 });
    expect(changes).toBe(2);
  });

  it('cue_records_of_old_generations_are_dropped', async () => {
    const samples = await readSamples(fixturePath('ce-slow'));
    const sentIds: string[] = [];
    let generation = 0;
    const session = sessionOf(
      await demonstration(),
      {
        ...recordingEffects([]),
        deviceDelayMs: () => 60,
        phraseMs: englishPhraseMs,
        nextGeneration: () => ++generation,
        sendCue: (cue: Cue) => sentIds.push(cue.id) > 0
      },
      { sideCueDistanceM: 1 }
    );
    const span = samples.at(-1)!.receivedMonoMs - samples[0]!.receivedMonoMs + 10000;
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
    const samples = await readSamples(fixturePath('ce-slow'));
    let changes = 0;
    const session = sessionOf(await demonstration(), { ...recordingEffects([]), changed: () => void changes++ });
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

describe('live gap', () => {
  type GapState = { rawIndex: number; timerMs: number; mode: string; gapMs: number | null };

  async function gapStates(fixture: string): Promise<{ states: GapState[]; records: AttemptRecord[] }> {
    const analysis = await demonstration();
    const records: AttemptRecord[] = [];
    const session = sessionOf({ ...analysis, events: [], corners: [] }, recordingEffects(records));
    const states: GapState[] = [];
    for (const sample of await readSamples(fixturePath(fixture))) {
      session.onSample(sample);
      states.push({ rawIndex: sample.rawIndex, timerMs: sample.gameTimerMs, mode: session.state.mode, gapMs: session.state.gapMs });
    }
    return { states, records };
  }

  it('live_gap_uses_the_game_timer_and_ends_at_the_review_gap', async () => {
    const { states, records } = await gapStates('ce-pause');
    expect(records).toMatchObject([{ completion: 'complete', reason: 'game-timer', gameTimeMs: 17412 }]);
    const pausedFrom = states.findIndex(state => state.mode === 'paused');
    const pausedTo = states.findIndex((state, index) => index > pausedFrom && state.mode === 'driving');
    expect(pausedFrom).toBeGreaterThan(0);
    expect(pausedTo).toBeGreaterThan(pausedFrom);
    const beforePause = states[pausedFrom - 1]!;
    expect(beforePause).toMatchObject({ mode: 'driving' });
    expect(beforePause.gapMs).not.toBeNull();
    for (const state of states.slice(pausedFrom, pausedTo)) expect(state.gapMs).toBe(beforePause.gapMs);
    const finishedAt = states.findIndex(state => state.mode === 'finished');
    expect(states[finishedAt]!.gapMs).toBeNull();
    const atFinish = states.slice(0, finishedAt).findLast(state => state.gapMs !== null)!;
    expect(atFinish).toMatchObject({ rawIndex: 13306, timerMs: 17412 });
    expect(Math.abs(atFinish.gapMs! - (records[0]!.gameTimeMs! - DEMONSTRATION_TIMER_MS))).toBeLessThanOrEqual(17);
  });

  it('live_gap_is_null_without_a_timer_value', async () => {
    const { states, records } = await gapStates('ce-off-track-reset');
    expect(records).toMatchObject([{ completion: 'aborted', reason: 'left-track' }]);
    const leftAt = states.findIndex(state => state.timerMs === -1 && state.mode === 'finished');
    expect(leftAt).toBeGreaterThan(0);
    expect(states[leftAt - 1]!.gapMs).not.toBeNull();
    expect(states.filter(state => state.timerMs <= 0).every(state => state.gapMs === null)).toBe(true);
  });
});
