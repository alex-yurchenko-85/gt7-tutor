import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
  AttemptReaction,
  BrakeReactionSummary,
  CornerReview,
  AttemptList,
  Sample,
  AttemptReview,
  AttemptSummary,
  Difference,
  StoredCueEvent,
  UpdateAttemptRequest
} from '@gt7/contracts';
import {
  DEFAULT_CONFIG,
  KPH_PER_MPS,
  brakeReactions,
  buildCueEvents,
  findCorners,
  findDifferences,
  buildReview,
  median,
  outsideM,
  seriesAt,
  type Corner,
  type Finding,
  type PlayedBrakeCue,
  type ReferencePath,
  type Review
} from '@gt7/core';
import { cornerInfo } from '../references/references.service.js';
import { FOCUS_ATTEMPTS, focusOf, focusSummary, recentFindings } from './attempt-focus.js';
import type { Knex } from 'knex';
import { ownedAttempt, ownedExercise, type AttemptRow, type CaptureRow, type ReferenceRow } from '../ownership/owned.js';
import { ReferencesService } from '../references/references.service.js';
import { KNEX } from '../storage/knex.provider.js';
import { localDate } from './local-date.js';

type FindingRow = { kind: Difference['kind']; event_key: string | null; s_m: number; size: number; unit: Difference['unit'] };

export function attemptTimeMs(row: Pick<AttemptRow, 'completion' | 'official_ms' | 'measured_ms'>): number | null {
  if (row.completion !== 'complete') return null;
  return row.official_ms ?? row.measured_ms;
}

function difference(row: FindingRow): Difference {
  return { kind: row.kind, eventKey: row.event_key, sM: row.s_m, size: row.size, unit: row.unit };
}

function largest(findings: Difference[]): Difference | null {
  return findings.reduce<Difference | null>((best, finding) => (best === null || finding.size > best.size ? finding : best), null);
}

export const REACTION_ATTEMPTS = 8;

const VOICED_OUTCOMES = ['sent', 'played'];

type CueRow = { event_key: string; outcome: string; decided_mono_ms: number; start_delay_ms: number | null; device_delay_ms: number | null };

function playedBrakeCues(rows: CueRow[]): PlayedBrakeCue[] {
  return rows.map(row => ({ eventKey: row.event_key, clipStartMonoMs: row.decided_mono_ms + (row.start_delay_ms ?? row.device_delay_ms ?? 0) }));
}

function cornerReview(corner: Corner, review: Review): CornerReview {
  const lateralM = seriesAt(review.attempt.lat, review.gridM, corner.apexSM);
  const speedMps = seriesAt(review.attempt.v, review.gridM, corner.apexSM);
  return {
    ...cornerInfo(corner),
    outsideM: lateralM === null ? null : outsideM(corner, lateralM),
    speedKph: speedMps === null ? null : speedMps * KPH_PER_MPS
  };
}

function isVoicedBrake(row: { event_key: string; outcome: string }): boolean {
  return row.event_key.startsWith('brake@') && VOICED_OUTCOMES.includes(row.outcome);
}

function eventPlace(eventKey: string): number {
  return Number(eventKey.slice(eventKey.indexOf('@') + 1));
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
    return (await this.summaries(attempt.exercise_id)).find(summary => summary.id === id)!;
  }

  async update(userId: string, id: string, body: UpdateAttemptRequest): Promise<AttemptSummary> {
    const attempt = await ownedAttempt(this.db, userId, id);
    if (attempt.completion !== 'complete' && (body.officialMs ?? null) !== null) {
      throw new ConflictException({ code: 'attempt-incomplete', reason: 'Only a complete attempt has an official time.' });
    }
    const changes: Record<string, unknown> = {};
    if (body.officialMs !== undefined) changes.official_ms = body.officialMs;
    if (body.medal !== undefined) changes.medal = body.medal;
    if (Object.keys(changes).length > 0) await this.db('attempts').where({ id }).update(changes);
    return this.get(userId, id);
  }

  async review(userId: string, id: string, referenceId?: string): Promise<AttemptReview> {
    const attempt = await ownedAttempt(this.db, userId, id);
    const reference = await this.referenceFor(attempt, referenceId ?? attempt.reference_id);
    const { review, findings, samples } = await this.compare(attempt, reference);
    const cues = await this.db('cue_events').where({ attempt_id: id }).orderBy('decided_mono_ms');
    const { corners, ...series } = review;
    const reactions: AttemptReaction[] = brakeReactions(samples, playedBrakeCues(cues.filter(isVoicedBrake)));
    return {
      referenceId: reference.id,
      ...series,
      findings,
      corners: corners.map(corner => cornerReview(corner, review)),
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
      .where({ exercise_id: exerciseId, completion: 'complete', mode: 'guided' })
      .orderBy([{ column: 'started_at', order: 'desc' }, { column: 'id', order: 'desc' }])
      .limit(REACTION_ATTEMPTS);
    const byEvent = new Map<string, number[]>();
    for (const attempt of attempts) {
      const cues = await this.db('cue_events').where({ attempt_id: attempt.id }).orderBy('decided_mono_ms').select<CueRow[]>('event_key', 'outcome', 'decided_mono_ms', 'start_delay_ms', 'device_delay_ms');
      const played = cues.filter(isVoicedBrake);
      if (played.length === 0) continue;
      for (const reaction of brakeReactions(await this.samplesFor(attempt), playedBrakeCues(played))) {
        byEvent.set(reaction.eventKey, [...(byEvent.get(reaction.eventKey) ?? []), reaction.reactionMs]);
      }
    }
    return [...byEvent.entries()]
      .map(([eventKey, values]) => ({ eventKey, medianMs: median(values), count: values.length }))
      .sort((a, b) => eventPlace(a.eventKey) - eventPlace(b.eventKey));
  }

  async findingsAgainst(attempt: AttemptRow, reference: ReferenceRow): Promise<Difference[]> {
    const stored = await this.storedFindings(attempt.id, reference.id);
    if (stored.length > 0) return stored;
    return (await this.compare(attempt, reference)).findings;
  }

  private async samplesFor(attempt: AttemptRow): Promise<Sample[]> {
    const capture = await this.db<CaptureRow>('captures').where({ id: attempt.capture_id }).first();
    return this.references.samplesOf(capture!, { first: attempt.first_raw_index, last: attempt.last_raw_index });
  }

  private async compare(attempt: AttemptRow, reference: ReferenceRow): Promise<{ review: Review; findings: Difference[]; samples: Sample[] }> {
    const samples = await this.samplesFor(attempt);
    const review = buildReview(samples, await this.references.pathOf(reference), DEFAULT_CONFIG);
    const findings = findDifferences(review, DEFAULT_CONFIG);
    await this.storeFindings(attempt.id, reference.id, findings);
    return { review, findings, samples };
  }

  private async storeFindings(attemptId: string, referenceId: string, findings: Finding[]): Promise<void> {
    await this.db.transaction(async trx => {
      await trx('attempt_findings').where({ attempt_id: attemptId, reference_id: referenceId }).delete();
      if (findings.length === 0) return;
      await trx('attempt_findings').insert(
        findings.map(finding => ({
          attempt_id: attemptId,
          reference_id: referenceId,
          kind: finding.kind,
          event_key: finding.eventKey,
          s_m: finding.sM,
          size: finding.size,
          unit: finding.unit
        }))
      );
    });
  }

  private async storedFindings(attemptId: string, referenceId: string): Promise<Difference[]> {
    const rows = await this.db('attempt_findings')
      .where({ attempt_id: attemptId, reference_id: referenceId })
      .orderBy('s_m')
      .select<FindingRow[]>('kind', 'event_key', 's_m', 'size', 'unit');
    return rows.map(difference);
  }

  private async referenceFor(attempt: AttemptRow, referenceId: string): Promise<ReferenceRow> {
    const reference = await this.db<ReferenceRow>('references').where({ id: referenceId, exercise_id: attempt.exercise_id }).first();
    if (!reference) throw new NotFoundException('Reference not found');
    return reference;
  }

  private async summaries(exerciseId: string): Promise<AttemptSummary[]> {
    const rows = await this.db<AttemptRow>('attempts').where({ exercise_id: exerciseId }).orderBy([{ column: 'started_at' }, { column: 'id' }]);
    const findingRows = await this.db('attempt_findings as f')
      .join('attempts as a', 'a.id', 'f.attempt_id')
      .where('a.exercise_id', exerciseId)
      .whereRaw('f.reference_id = a.reference_id')
      .select<(FindingRow & { attempt_id: string })[]>('f.attempt_id', 'f.kind', 'f.event_key', 's_m', 'size', 'unit');
    const bestMs = bestOf(rows.map(attemptTimeMs));
    const corners = await this.cornersOf(rows);
    const focuses = new Map<string, AttemptSummary['focus']>();
    for (const row of rows) {
      if (row.completion !== 'complete') continue;
      const scope = { exerciseId, referenceId: row.reference_id, upTo: { startedAt: row.started_at, id: row.id } };
      focuses.set(row.id, focusSummary(focusOf(await recentFindings(this.db, scope, FOCUS_ATTEMPTS), corners.get(row.reference_id) ?? [])));
    }
    return rows.map((row, index) => {
      const timeMs = attemptTimeMs(row);
      return {
        id: row.id,
        exerciseId: row.exercise_id,
        number: index + 1,
        referenceId: row.reference_id,
        captureId: row.capture_id,
        first: row.first_raw_index,
        last: row.last_raw_index,
        mode: row.mode,
        completion: row.completion,
        reason: row.reason,
        measuredMs: row.completion === 'complete' ? row.measured_ms : null,
        officialMs: row.official_ms,
        medal: row.medal,
        timeMs,
        gapToBestMs: timeMs === null || bestMs === null ? null : timeMs - bestMs,
        largestDifference: largest(findingRows.filter(finding => finding.attempt_id === row.id).map(difference)),
        focus: focuses.get(row.id) ?? null,
        startedAt: row.started_at.toISOString()
      };
    });
  }

  private async cornersOf(rows: AttemptRow[]): Promise<Map<string, Corner[]>> {
    const corners = new Map<string, Corner[]>();
    for (const referenceId of new Set(rows.filter(row => row.completion === 'complete').map(row => row.reference_id))) {
      const reference = await this.db<ReferenceRow>('references').where({ id: referenceId }).first();
      if (!reference) continue;
      const path: ReferencePath = await this.references.pathOf(reference);
      corners.set(referenceId, findCorners(path, buildCueEvents(path, DEFAULT_CONFIG), DEFAULT_CONFIG));
    }
    return corners;
  }
}
