import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  eventKeyPlace,
  type AttemptReaction,
  type BrakeReactionSummary,
  type AttemptList,
  type Sample,
  type AttemptReview,
  type AttemptSummary,
  type StoredCueEvent
} from '@gt7/contracts';
import {
  COMPARISON_VERSION,
  DEFAULT_CONFIG,
  brakeReactions,
  findDifferences,
  buildReview,
  focusFor,
  median,
  reviewLosses,
  type Corner,
  type Finding,
  type FocusAttempt,
  type PlayedBrakeCue,
  type Review,
  type TurnLoss
} from '@gt7/core';
import { focusSummary } from './attempt-focus.js';
import type { Knex } from 'knex';
import { ownedAttempt, ownedExercise, type AttemptRow, type CaptureRow, type ReferenceRow } from '../ownership/owned.js';
import { ReferencesService } from '../references/references.service.js';
import { KNEX } from '../storage/knex.provider.js';
import { FINDING_COLUMNS, saveComparison, toFinding, type FindingRow } from './finding-rows.js';
import { localDate } from './local-date.js';
import { reviewBody, turnLossInfos } from './review-shapes.js';
import { httpError } from '../http-errors.js';

export function attemptTimeMs(row: Pick<AttemptRow, 'completion' | 'game_ms'>): number | null {
  return row.completion === 'complete' ? row.game_ms : null;
}

export const REACTION_ATTEMPTS = 8;

const VOICED_OUTCOMES = ['sent', 'played'];

type CueRow = { event_key: string; event_kind: string; outcome: string; decided_mono_ms: number; start_delay_ms: number | null; device_delay_ms: number | null };

function playedBrakeCues(rows: CueRow[]): PlayedBrakeCue[] {
  return rows.map(row => ({ eventKey: row.event_key, clipStartMonoMs: row.decided_mono_ms + (row.start_delay_ms ?? row.device_delay_ms ?? 0) }));
}

function isVoicedBrake(row: Pick<CueRow, 'event_kind' | 'outcome'>): boolean {
  return row.event_kind === 'brake' && VOICED_OUTCOMES.includes(row.outcome);
}

function bestOf(times: (number | null)[]): number | null {
  const known = times.filter((time): time is number => time !== null);
  return known.length > 0 ? Math.min(...known) : null;
}

@Injectable()
export class AttemptsService {
  private readonly logger = new Logger(AttemptsService.name);

  constructor(
    @Inject(KNEX) private readonly db: Knex,
    private readonly references: ReferencesService
  ) {}

  async list(userId: string, exerciseId: string): Promise<AttemptList> {
    await ownedExercise(this.db, userId, exerciseId);
    const summaries = await this.summaries(exerciseId);
    const bestMs = bestOf(summaries.map(summary => summary.timeMs));
    const days = new Map<string, AttemptSummary[]>();
    for (const summary of [...summaries].reverse()) {
      const date = localDate(new Date(summary.startedAt));
      days.set(date, [...(days.get(date) ?? []), summary]);
    }
    return {
      bestMs,
      days: [...days.entries()].map(([date, attempts]) => ({ date, bestMs: bestOf(attempts.map(item => item.timeMs)), attempts }))
    };
  }

  async get(userId: string, id: string): Promise<AttemptSummary> {
    const attempt = await ownedAttempt(this.db, userId, id);
    return (await this.summaries(attempt.exercise_id, id))[0]!;
  }

  async review(userId: string, id: string, referenceId?: string): Promise<AttemptReview> {
    const attempt = await ownedAttempt(this.db, userId, id);
    const reference = await this.referenceFor(attempt, referenceId ?? attempt.reference_id);
    const { review, findings, losses, samples, referenceTimeMs } = await this.compare(attempt, reference);
    const cues = await this.db('cue_events').where({ attempt_id: id }).orderBy('decided_mono_ms');
    const reactions: AttemptReaction[] = brakeReactions(samples, playedBrakeCues(cues.filter(isVoicedBrake)));
    return {
      referenceId: reference.id,
      referenceTimeMs,
      ...reviewBody(review, findings),
      turnLosses: turnLossInfos(losses),
      reactions,
      cues: cues.map(
        (row): StoredCueEvent => ({
          eventKey: row.event_key,
          kind: row.kind,
          targetKph: row.target_kph,
          decidedMonoMs: row.decided_mono_ms,
          outcome: row.outcome,
          startDelayMs: row.start_delay_ms
        })
      )
    };
  }

  async reactions(userId: string, exerciseId: string): Promise<BrakeReactionSummary[]> {
    await ownedExercise(this.db, userId, exerciseId);
    const attempts = await this.db<AttemptRow>('attempts')
      .where({ exercise_id: exerciseId, completion: 'complete' })
      .orderBy([{ column: 'started_at', order: 'desc' }, { column: 'id', order: 'desc' }])
      .limit(REACTION_ATTEMPTS);
    const byEvent = new Map<string, number[]>();
    for (const attempt of attempts) {
      const cues = await this.db('cue_events').where({ attempt_id: attempt.id }).orderBy('decided_mono_ms').select<CueRow[]>('event_key', 'event_kind', 'outcome', 'decided_mono_ms', 'start_delay_ms', 'device_delay_ms');
      const played = cues.filter(isVoicedBrake);
      if (played.length === 0) continue;
      for (const reaction of brakeReactions(await this.samplesFor(attempt), playedBrakeCues(played))) {
        byEvent.set(reaction.eventKey, [...(byEvent.get(reaction.eventKey) ?? []), reaction.reactionMs]);
      }
    }
    return [...byEvent.entries()]
      .map(([eventKey, values]) => ({ eventKey, medianMs: median(values), count: values.length }))
      .sort((a, b) => (eventKeyPlace(a.eventKey) ?? 0) - (eventKeyPlace(b.eventKey) ?? 0));
  }

  async cornersOfReference(reference: ReferenceRow): Promise<Corner[]> {
    return (await this.references.analysisOf(reference)).corners;
  }

  async comparisonsFor(attemptIds: string[], referenceId: string, recalculate: string[] = attemptIds): Promise<Map<string, FocusAttempt>> {
    const [rows, compared] = await Promise.all([
      this.db('attempt_findings')
        .whereIn('attempt_id', attemptIds)
        .andWhere({ reference_id: referenceId })
        .orderBy('s_m')
        .select<FindingRow[]>(...FINDING_COLUMNS),
      this.db('attempt_comparisons')
        .whereIn('attempt_id', attemptIds)
        .andWhere({ reference_id: referenceId, version: COMPARISON_VERSION })
        .select<{ attempt_id: string; turn_losses: TurnLoss[] }[]>('attempt_id', 'turn_losses')
    ]);
    const known = new Map(compared.map(row => [row.attempt_id, row.turn_losses]));
    const found = new Map(attemptIds.map((id): [string, FocusAttempt] => [id, { findings: [], losses: known.get(id) ?? [] }]));
    for (const row of rows) if (known.has(row.attempt_id)) found.get(row.attempt_id)!.findings.push(toFinding(row));
    const allowed = new Set(recalculate);
    const missing = attemptIds.filter(id => !known.has(id) && allowed.has(id));
    for (const id of attemptIds) if (!known.has(id) && !allowed.has(id)) found.delete(id);
    if (missing.length === 0) return found;
    const reference = (await this.db<ReferenceRow>('references').where({ id: referenceId }).first())!;
    const attempts = await this.db<AttemptRow>('attempts').whereIn('id', missing);
    for (const attempt of attempts) {
      const compared = await this.compare(attempt, reference).catch((error: unknown) => {
        this.logger.warn(`Differences of attempt ${attempt.id} not calculated: ${error instanceof Error ? error.message : String(error)}`);
        return null;
      });
      found.set(attempt.id, compared ? { findings: compared.findings, losses: compared.losses } : { findings: rows.filter(row => row.attempt_id === attempt.id).map(toFinding), losses: [] });
    }
    return found;
  }

  private async samplesFor(attempt: AttemptRow): Promise<Sample[]> {
    const capture = await this.db<CaptureRow>('captures').where({ id: attempt.capture_id }).first();
    return this.references.samplesOf(capture!, { first: attempt.first_raw_index, last: attempt.last_raw_index });
  }

  private async compare(
    attempt: AttemptRow,
    reference: ReferenceRow
  ): Promise<{ review: Review; findings: Finding[]; losses: TurnLoss[]; samples: Sample[]; referenceTimeMs: number }> {
    const samples = await this.samplesFor(attempt);
    const analysis = await this.references.analysisOf(reference);
    const review = buildReview(samples, analysis, DEFAULT_CONFIG);
    const findings = samples.length >= 2 ? findDifferences(review, DEFAULT_CONFIG) : [];
    const losses = reviewLosses(review);
    await this.db.transaction(trx => saveComparison(trx, attempt.id, reference.id, { findings, losses }));
    return { review, findings, losses, samples, referenceTimeMs: analysis.timeMs };
  }

  private async referenceFor(attempt: AttemptRow, referenceId: string): Promise<ReferenceRow> {
    const reference = await this.db<ReferenceRow>('references').where({ id: referenceId, exercise_id: attempt.exercise_id }).first();
    if (!reference) throw httpError(404, 'reference-not-found');
    return reference;
  }

  private async summaries(exerciseId: string, only?: string): Promise<AttemptSummary[]> {
    const [rows, exercise] = await Promise.all([
      this.db<AttemptRow>('attempts').where({ exercise_id: exerciseId }).orderBy([{ column: 'started_at' }, { column: 'id' }]),
      this.db('exercises').where({ id: exerciseId }).first<{ active_reference_id: string | null } | undefined>('active_reference_id')
    ]);
    const comparisons = new Map<string, FocusAttempt>();
    const newest = rows.findLast(row => row.reference_id === exercise?.active_reference_id && row.completion === 'complete');
    const needed = new Set(only !== undefined ? [only] : newest ? [newest.id] : []);
    for (const referenceId of new Set(rows.map(row => row.reference_id))) {
      const ids = rows.filter(row => row.reference_id === referenceId).map(row => row.id);
      for (const [id, found] of await this.comparisonsFor(ids, referenceId, ids.filter(id => needed.has(id)))) comparisons.set(id, found);
    }
    const bestMs = bestOf(rows.map(attemptTimeMs));
    const summaries: AttemptSummary[] = [];
    rows.forEach((row, index) => {
      if (only !== undefined && row.id !== only) return;
      const comparison = comparisons.get(row.id) ?? { findings: [], losses: [] };
      const focus = row.completion === 'complete' ? focusSummary(focusFor(comparison, DEFAULT_CONFIG)) : null;
      const timeMs = attemptTimeMs(row);
      const summary = {
        id: row.id,
        exerciseId: row.exercise_id,
        number: index + 1,
        referenceId: row.reference_id,
        captureId: row.capture_id,
        first: row.first_raw_index,
        last: row.last_raw_index,
        reason: row.reason,
        gapToBestMs: timeMs === null || bestMs === null ? null : timeMs - bestMs,
        focus,
        startedAt: row.started_at.toISOString()
      };
      summaries.push(timeMs === null ? { ...summary, completion: 'aborted', timeMs: null } : { ...summary, completion: 'complete', timeMs });
    });
    return summaries;
  }
}
