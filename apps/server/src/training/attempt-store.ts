import { buildReview, findDifferences, reviewLosses, type CoreConfig, type FocusAttempt } from '@gt7/core';
import type { Knex } from 'knex';
import { saveComparison } from '../attempts/finding-rows.js';
import type { AttemptRecord, CueRecord, TrainingSnapshot } from './training-session.js';

export type StoredAttempt = { id: string; storedOutcomes: Map<CueRecord, string> };

function cueRow(attemptId: string, record: CueRecord) {
  return {
    attempt_id: attemptId,
    event_key: record.eventKey,
    kind: record.kind,
    event_kind: record.eventKind,
    s_m: record.sM,
    target_kph: record.targetKph,
    decided_mono_ms: record.decidedMonoMs,
    outcome: record.outcome,
    start_delay_ms: record.startDelayMs,
    device_delay_ms: record.deviceDelayMs
  };
}

export function attemptComparison(snapshot: TrainingSnapshot, record: AttemptRecord, config: CoreConfig): FocusAttempt {
  if (record.samples.length < 2) return { findings: [], losses: [] };
  const review = buildReview(record.samples, snapshot.analysis, config);
  return { findings: findDifferences(review, config), losses: reviewLosses(review) };
}

export async function storeAttempt(
  db: Knex,
  snapshot: TrainingSnapshot,
  captureId: string,
  record: AttemptRecord,
  comparison: FocusAttempt
): Promise<StoredAttempt> {
  const complete = record.completion === 'complete';
  const storedOutcomes = new Map(record.cues.map(cue => [cue, cue.outcome]));
  const id = await db.transaction(async trx => {
    const [row] = await trx('attempts')
      .insert({
        exercise_id: snapshot.exerciseId,
        capture_id: captureId,
        reference_id: snapshot.referenceId,
        first_raw_index: record.firstRawIndex,
        last_raw_index: record.lastRawIndex,
        completion: record.completion,
        reason: record.reason,
        game_ms: complete ? record.gameTimeMs : null,
        started_at: record.startedAt
      })
      .returning<{ id: string }[]>('id');
    const attemptId = row!.id;
    await saveComparison(trx, attemptId, snapshot.referenceId, comparison);
    if (record.cues.length > 0) await trx('cue_events').insert(record.cues.map(cue => cueRow(attemptId, cue)));
    return attemptId;
  });
  return { id, storedOutcomes };
}

export async function updateCueOutcome(db: Knex, attemptId: string, record: CueRecord): Promise<void> {
  await db('cue_events')
    .where({ attempt_id: attemptId, event_key: record.eventKey })
    .whereNot('outcome', 'like', 'suppressed-%')
    .update({ outcome: record.outcome, start_delay_ms: record.startDelayMs });
}
