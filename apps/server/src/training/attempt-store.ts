import { buildReview, findDifferences, measureAttemptTimes, type CoreConfig, type Finding } from '@gt7/core';
import type { Knex } from 'knex';
import type { AttemptRecord, CueRecord, TrainingSnapshot } from './training-session.js';

export type StoredAttempt = { id: string; storedOutcomes: Map<CueRecord, string> };

function cueRow(attemptId: string, record: CueRecord) {
  return {
    attempt_id: attemptId,
    event_key: record.eventKey,
    kind: record.kind,
    target_kph: record.targetKph,
    decided_mono_ms: record.decidedMonoMs,
    outcome: record.outcome,
    start_delay_ms: record.startDelayMs,
    device_delay_ms: record.deviceDelayMs
  };
}

export function attemptFindings(snapshot: TrainingSnapshot, record: AttemptRecord, config: CoreConfig): Finding[] {
  return record.samples.length >= 2 ? findDifferences(buildReview(record.samples, snapshot.path, config), config) : [];
}

export async function storeAttempt(
  db: Knex,
  snapshot: TrainingSnapshot,
  captureId: string,
  record: AttemptRecord,
  findings: Finding[],
  config: CoreConfig
): Promise<StoredAttempt> {
  const complete = record.completion === 'complete';
  const measuredMs = complete ? measureAttemptTimes(record.samples, config).measuredMs : null;
  const storedOutcomes = new Map(record.cues.map(cue => [cue, cue.outcome]));
  const id = await db.transaction(async trx => {
    const [row] = await trx('attempts')
      .insert({
        exercise_id: snapshot.exerciseId,
        capture_id: captureId,
        reference_id: snapshot.referenceId,
        first_raw_index: record.firstRawIndex,
        last_raw_index: record.lastRawIndex,
        mode: snapshot.mode,
        completion: record.completion,
        reason: record.reason,
        measured_ms: measuredMs,
        game_ms: complete ? record.gameTimeMs : null,
        started_at: record.startedAt
      })
      .returning<{ id: string }[]>('id');
    const attemptId = row!.id;
    if (findings.length > 0) {
      await trx('attempt_findings').insert(
        findings.map(finding => ({
          attempt_id: attemptId,
          reference_id: snapshot.referenceId,
          kind: finding.kind,
          event_key: finding.eventKey,
          s_m: finding.sM,
          size: finding.size,
          unit: finding.unit
        }))
      );
    }
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
