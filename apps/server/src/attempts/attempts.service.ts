import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  eventKeyPlace,
  type AttemptReaction,
  type BrakeReactionSummary,
  type CornerInfo,
  type CornerReview,
  type AttemptList,
  type Sample,
  type AttemptReview,
  type AttemptSummary,
  type Difference,
  type StoredCueEvent
} from '@gt7/contracts';
import {
  DEFAULT_CONFIG,
  brakeReactions,
  comparableSize,
  findDifferences,
  buildReview,
  median,
  outsideM,
  seriesAt,
  turnLosses,
  turnOf,
  type Corner,
  type Finding,
  type PlayedBrakeCue,
  type Review
} from '@gt7/core';
import { cornerInfos } from '../references/references.service.js';
import { FOCUS_ATTEMPTS, focusOf, focusSummary } from './attempt-focus.js';
import type { Knex } from 'knex';
import { ownedAttempt, ownedExercise, type AttemptRow, type CaptureRow, type ReferenceRow } from '../ownership/owned.js';
import { ReferencesService } from '../references/references.service.js';
import { KNEX } from '../storage/knex.provider.js';
import { FINDING_COLUMNS, saveComparison, toFinding, type FindingRow } from './finding-rows.js';
import { localDate } from './local-date.js';

export function attemptTimeMs(row: Pick<AttemptRow, 'completion' | 'game_ms'>): number | null {
  return row.completion === 'complete' ? row.game_ms : null;
}

export function withTurn(finding: Finding, corners: Corner[]): Difference {
  return { ...finding, turn: turnOf(corners, finding.sM) };
}

function largest(findings: Difference[]): Difference | null {
  return findings.reduce<Difference | null>((best, finding) => (best === null || comparableSize(finding.size, finding.unit) > comparableSize(best.size, best.unit) ? finding : best), null);
}

export const REACTION_ATTEMPTS = 8;

const VOICED_OUTCOMES = ['sent', 'played'];

type CueRow = { event_key: string; event_kind: string; outcome: string; decided_mono_ms: number; start_delay_ms: number | null; device_delay_ms: number | null };

function playedBrakeCues(rows: CueRow[]): PlayedBrakeCue[] {
  return rows.map(row => ({ eventKey: row.event_key, clipStartMonoMs: row.decided_mono_ms + (row.start_delay_ms ?? row.device_delay_ms ?? 0) }));
}

function cornerReviews(review: Review): CornerReview[] {
  const infos = cornerInfos(review.corners, review.lengthM);
  return review.corners.map((corner, index) => cornerReview(corner, infos[index]!, review));
}

function cornerReview(corner: Corner, info: CornerInfo, review: Review): CornerReview {
  const lateralM = seriesAt(review.attempt.lat, review.gridM, corner.apexSM);
  const speedMps = seriesAt(review.attempt.v, review.gridM, corner.apexSM);
  return {
    ...info,
    outsideM: lateralM === null ? null : outsideM(corner, lateralM),
    speedMps
  };
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
    const { review, findings, samples, referenceTimeMs } = await this.compare(attempt, reference);
    const cues = await this.db('cue_events').where({ attempt_id: id }).orderBy('decided_mono_ms');
    const { corners, ...series } = review;
    const reactions: AttemptReaction[] = brakeReactions(samples, playedBrakeCues(cues.filter(isVoicedBrake)));
    return {
      referenceId: reference.id,
      referenceTimeMs,
      ...series,
      findings: findings.map(finding => withTurn(finding, corners)),
      turnLosses: turnLosses(corners, review.lengthM, review.gridM, review.attempt.t, review.reference.t),
      corners: cornerReviews(review),
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

  async findingsFor(attemptIds: string[], referenceId: string): Promise<Map<string, Finding[]>> {
    const [rows, compared] = await Promise.all([
      this.db('attempt_findings')
        .whereIn('attempt_id', attemptIds)
        .andWhere({ reference_id: referenceId })
        .orderBy('s_m')
        .select<FindingRow[]>(...FINDING_COLUMNS),
      this.db('attempt_comparisons').whereIn('attempt_id', attemptIds).andWhere({ reference_id: referenceId }).pluck<string[]>('attempt_id')
    ]);
    const found = new Map(attemptIds.map((id): [string, Finding[]] => [id, []]));
    for (const row of rows) found.get(row.attempt_id)!.push(toFinding(row));
    const known = new Set(compared);
    const missing = attemptIds.filter(id => !known.has(id));
    if (missing.length === 0) return found;
    const reference = (await this.db<ReferenceRow>('references').where({ id: referenceId }).first())!;
    const attempts = await this.db<AttemptRow>('attempts').whereIn('id', missing);
    await Promise.all(
      attempts.map(async attempt => {
        found.set(attempt.id, (await this.compare(attempt, reference)).findings);
      })
    );
    return found;
  }

  private async samplesFor(attempt: AttemptRow): Promise<Sample[]> {
    const capture = await this.db<CaptureRow>('captures').where({ id: attempt.capture_id }).first();
    return this.references.samplesOf(capture!, { first: attempt.first_raw_index, last: attempt.last_raw_index });
  }

  private async compare(attempt: AttemptRow, reference: ReferenceRow): Promise<{ review: Review; findings: Finding[]; samples: Sample[]; referenceTimeMs: number }> {
    const samples = await this.samplesFor(attempt);
    const analysis = await this.references.analysisOf(reference);
    const review = buildReview(samples, analysis, DEFAULT_CONFIG);
    const findings = findDifferences(review, DEFAULT_CONFIG);
    await this.recordComparison(attempt.id, reference.id, findings);
    return { review, findings, samples, referenceTimeMs: analysis.timeMs };
  }

  private async recordComparison(attemptId: string, referenceId: string, findings: Finding[]): Promise<void> {
    await this.db.transaction(trx => saveComparison(trx, attemptId, referenceId, findings));
  }

  private async referenceFor(attempt: AttemptRow, referenceId: string): Promise<ReferenceRow> {
    const reference = await this.db<ReferenceRow>('references').where({ id: referenceId, exercise_id: attempt.exercise_id }).first();
    if (!reference) throw new NotFoundException('Reference not found');
    return reference;
  }

  private async summaries(exerciseId: string, only?: string): Promise<AttemptSummary[]> {
    const rows = await this.db<AttemptRow>('attempts').where({ exercise_id: exerciseId }).orderBy([{ column: 'started_at' }, { column: 'id' }]);
    const findingRows = await this.db('attempt_findings as f')
      .join('attempts as a', 'a.id', 'f.attempt_id')
      .where('a.exercise_id', exerciseId)
      .whereRaw('f.reference_id = a.reference_id')
      .orderBy('f.s_m')
      .select<FindingRow[]>(...FINDING_COLUMNS.map(column => `f.${column}`));
    const findings = new Map<string, Finding[]>();
    for (const row of findingRows) findings.set(row.attempt_id, [...(findings.get(row.attempt_id) ?? []), toFinding(row)]);
    const bestMs = bestOf(rows.map(attemptTimeMs));
    const corners = await this.cornersOf(rows);
    const history = new Map<string, Finding[][]>();
    const summaries: AttemptSummary[] = [];
    rows.forEach((row, index) => {
      const own = findings.get(row.id) ?? [];
      let focus: AttemptSummary['focus'] = null;
      if (row.completion === 'complete') {
        const recent = [...(history.get(row.reference_id) ?? []), own];
        history.set(row.reference_id, recent);
        if (only === undefined || row.id === only) focus = focusSummary(focusOf(recent.slice(-FOCUS_ATTEMPTS).reverse(), corners.get(row.reference_id)!));
      }
      if (only !== undefined && row.id !== only) return;
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
        largestDifference: largest(own.map(finding => withTurn(finding, corners.get(row.reference_id)!))),
        focus,
        startedAt: row.started_at.toISOString()
      };
      summaries.push(timeMs === null ? { ...summary, completion: 'aborted', timeMs: null } : { ...summary, completion: 'complete', timeMs });
    });
    return summaries;
  }

  private async cornersOf(rows: AttemptRow[]): Promise<Map<string, Corner[]>> {
    const corners = new Map<string, Corner[]>();
    const references = await this.db<ReferenceRow>('references').whereIn('id', [...new Set(rows.map(row => row.reference_id))]);
    for (const reference of references) corners.set(reference.id, await this.cornersOfReference(reference));
    return corners;
  }
}
