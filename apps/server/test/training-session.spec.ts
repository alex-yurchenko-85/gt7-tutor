import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, buildReference, measureAttemptTimes } from '@gt7/core';
import { readSamples } from '../src/captures/capture-samples.js';
import { TrainingSession, type AttemptRecord, type TrainingEffects } from '../src/training/training-session.js';

const CE_CLEAN = fileURLToPath(new URL('../../../fixtures/ce-clean.ndjson', import.meta.url));

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
    const path = buildReference(samples.filter(sample => sample.rawIndex >= 8452 && sample.rawIndex <= 9476), 'flying');
    const records: AttemptRecord[] = [];
    const session = new TrainingSession(
      {
        userId: 'user',
        exerciseId: 'exercise',
        referenceId: 'reference',
        mode: 'baseline',
        path,
        events: [],
        mutedKeys: new Set(),
        speakTargets: false,
        offsetsMs: new Map(),
        sideCueDistanceM: null
      },
      DEFAULT_CONFIG,
      recordingEffects(records)
    );
    for (const sample of samples) session.onSample(sample);
    expect(records).toHaveLength(1);
    const [record] = records;
    expect(record).toMatchObject({ completion: 'complete', reason: 'game-timer', firstRawIndex: 8451, lastRawIndex: 9479, gameTimeMs: 17071 });
    const times = measureAttemptTimes(record!.samples, DEFAULT_CONFIG);
    expect(times.gameMs).toBe(17071);
    expect(Math.abs(times.measuredMs! - 17071)).toBeLessThanOrEqual(100);
  });
});
