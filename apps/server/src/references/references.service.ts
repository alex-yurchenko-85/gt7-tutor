import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import {
  KPH_PER_MPS,
  type CornerInfo,
  type CreateReferenceRequest,
  type RawRange,
  type ReferenceCheckResult,
  type ReferenceCue,
  type ReferenceInfo,
  type ReferenceOrigin,
  type ReferenceProposal,
  type ReferenceTrace,
  type Sample
} from '@gt7/contracts';
import {
  DEFAULT_CONFIG,
  ReferencePathError,
  analyseReference,
  buildReference,
  clipKey,
  clipsOf,
  cueText,
  cutToTimerRun,
  demonstrationRuns,
  eventPhrase,
  findDemoRangeCandidates,
  matchesReference,
  pointAt,
  targetClip,
  turnZones,
  type Corner,
  type GameTimerSession,
  type ReferenceAnalysis,
  type TimerRunRange
} from '@gt7/core';
import type { Knex } from 'knex';
import { badRequest, conflict } from '../http-errors.js';
import { CaptureService } from '../captures/capture.service.js';
import { SampleCache } from '../captures/sample-cache.js';
import {
  ownedAttempt,
  ownedCapture,
  ownedExercise,
  ownedReference,
  type CaptureRow,
  type ExerciseRow,
  type ReferenceRow
} from '../ownership/owned.js';
import { SettingsService } from '../settings/settings.service.js';
import { KNEX } from '../storage/knex.provider.js';
import { dropOldest } from '../drop-oldest.js';

type ReferenceSource = {
  exercise: ExerciseRow;
  capture: CaptureRow;
  range: RawRange;
  timerMs: number;
  origin: ReferenceOrigin;
};

type ReferenceListRow = ReferenceRow & { attempt_count: number; active: boolean };

export type ReferenceDeleteGate = (userId: string, referenceId: string) => Promise<void>;

const FOREIGN_KEY_VIOLATION = '23503';

export const ANALYSIS_CACHE_SIZE = 8;

function isForeignKeyViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === FOREIGN_KEY_VIOLATION;
}

function referenceInfo(row: ReferenceListRow): ReferenceInfo {
  return {
    id: row.id,
    exerciseId: row.exercise_id,
    captureId: row.capture_id,
    first: row.first_raw_index,
    last: row.last_raw_index,
    origin: row.origin,
    gameVersion: row.game_version,
    needsCheck: row.needs_check,
    active: row.active,
    attemptCount: row.attempt_count,
    createdAt: row.created_at.toISOString()
  };
}

export function cornerInfos(corners: Corner[], lengthM: number): CornerInfo[] {
  const zones = turnZones(corners, lengthM);
  return corners.map((corner, index) => ({
    number: corner.number,
    turnInSM: corner.turnInSM,
    apexSM: corner.apexSM,
    radiusM: corner.radiusM,
    apexSpeedMps: corner.apexSpeedMps,
    zoneFromSM: zones[index]!.fromSM,
    zoneToSM: zones[index]!.toSM
  }));
}

function carOf(samples: Sample[]): number | null {
  return samples.find(sample => sample.playerSession)?.carId ?? samples[0]?.carId ?? null;
}

@Injectable()
export class ReferencesService {
  constructor(
    @Inject(KNEX) private readonly db: Knex,
    private readonly captures: CaptureService,
    private readonly settings: SettingsService,
    private readonly samples: SampleCache
  ) {}

  private deleteGate: ReferenceDeleteGate | null = null;
  private readonly analyses = new Map<string, Promise<ReferenceAnalysis>>();

  useDeleteGate(gate: ReferenceDeleteGate): void {
    this.deleteGate = gate;
  }

  async samplesOf(capture: CaptureRow, range?: RawRange): Promise<Sample[]> {
    return this.samples.read(capture.id, this.captures.rawPath(capture), range);
  }

  analysisOf(reference: ReferenceRow): Promise<ReferenceAnalysis> {
    const cached = this.analyses.get(reference.id);
    if (cached) {
      this.analyses.delete(reference.id);
      this.analyses.set(reference.id, cached);
      return cached;
    }
    const analysis = this.analyse(reference);
    this.analyses.set(reference.id, analysis);
    dropOldest(this.analyses, ANALYSIS_CACHE_SIZE);
    analysis.catch(() => {
      if (this.analyses.get(reference.id) === analysis) this.analyses.delete(reference.id);
    });
    return analysis;
  }

  private async analyse(reference: ReferenceRow): Promise<ReferenceAnalysis> {
    const capture = await this.db<CaptureRow>('captures').where({ id: reference.capture_id }).first();
    const samples = await this.samplesOf(capture!, { first: reference.first_raw_index, last: reference.last_raw_index });
    const analysis = analyseReference(samples, DEFAULT_CONFIG);
    if (reference.timer_ms !== null) return { ...analysis, timeMs: reference.timer_ms };
    await this.db('references').where({ id: reference.id }).whereNull('timer_ms').update({ timer_ms: analysis.timeMs });
    return analysis;
  }

  async proposals(userId: string, exerciseId: string, captureIds: string[]): Promise<ReferenceProposal[]> {
    await ownedExercise(this.db, userId, exerciseId);
    const captures = await Promise.all(captureIds.map(id => this.finishedCapture(userId, id)));
    const samples = await Promise.all(captures.map(capture => this.samplesOf(capture)));
    if (captures.length === 1) return this.runProposals(captures[0]!, samples[0]!);
    return findDemoRangeCandidates(samples)
      .filter(candidate => candidate.timed)
      .map(candidate => ({
        ranges: candidate.ranges.map((range, index) => ({ captureId: captures[index]!.id, first: range.first, last: range.last })),
        sampleCount: candidate.sampleCount,
        ambiguous: candidate.ambiguous,
        evidence: candidate.evidence,
        timeMs: cutToTimerRun(samples[0]!, candidate.ranges[0]!, 'demonstration')!.gameTimeMs
      }));
  }

  private runProposals(capture: CaptureRow, samples: Sample[]): ReferenceProposal[] {
    const runs = demonstrationRuns(samples);
    return runs.map(run => ({
      ranges: [{ captureId: capture.id, first: run.first, last: run.last }],
      sampleCount: samples.filter(sample => sample.rawIndex >= run.first && sample.rawIndex <= run.last).length,
      ambiguous: runs.length > 1,
      evidence: [`Timer runs ${(run.gameTimeMs / 1000).toFixed(3)} s`],
      timeMs: run.gameTimeMs
    }));
  }

  async create(userId: string, body: CreateReferenceRequest): Promise<ReferenceInfo> {
    const exercise = await ownedExercise(this.db, userId, body.exerciseId);
    const capture = await this.finishedCapture(userId, body.captureId);
    const range = await this.timerRunOf(capture, { first: body.first, last: body.last }, 'demonstration');
    return this.store({ exercise, capture, range, timerMs: range.gameTimeMs, origin: 'demo' });
  }

  async promote(userId: string, attemptId: string): Promise<ReferenceInfo> {
    const attempt = await ownedAttempt(this.db, userId, attemptId);
    if (attempt.completion !== 'complete') {
      throw conflict('not-complete', 'Only a complete attempt can become a reference.');
    }
    const exercise = await ownedExercise(this.db, userId, attempt.exercise_id);
    const capture = await this.finishedCapture(userId, attempt.capture_id);
    const range = await this.timerRunOf(capture, { first: attempt.first_raw_index, last: attempt.last_raw_index }, 'player');
    return this.store({ exercise, capture, range, timerMs: attempt.game_ms!, origin: 'attempt' });
  }

  async history(userId: string, exerciseId: string): Promise<ReferenceInfo[]> {
    await ownedExercise(this.db, userId, exerciseId);
    return (await this.listRows({ 'r.exercise_id': exerciseId })).map(referenceInfo);
  }

  async activate(userId: string, id: string): Promise<ReferenceInfo> {
    const reference = await ownedReference(this.db, userId, id);
    await this.db('exercises').where({ id: reference.exercise_id }).update({ active_reference_id: reference.id });
    return this.info(reference.id);
  }

  async remove(userId: string, id: string): Promise<{ ok: true }> {
    const reference = await ownedReference(this.db, userId, id);
    await this.deleteGate?.(userId, reference.id);
    let deleted: number;
    try {
      deleted = await this.db('references')
        .where({ id: reference.id })
        .whereNotIn('id', this.db('exercises').whereNotNull('active_reference_id').select('active_reference_id'))
        .delete();
    } catch (error) {
      if (isForeignKeyViolation(error)) throw conflict('reference-in-use', 'Attempts point to this reference. It cannot be deleted.');
      throw error;
    }
    if (deleted === 0) throw conflict('reference-active', 'Activate another reference first.');
    return { ok: true };
  }

  async check(userId: string, id: string, captureId: string): Promise<ReferenceCheckResult> {
    const reference = await ownedReference(this.db, userId, id);
    const capture = await this.finishedCapture(userId, captureId);
    const range = matchesReference(await this.samplesOf(capture), (await this.analysisOf(reference)).path);
    if (range) {
      const gameVersion = await this.settings.get('gameVersion');
      await this.db('references')
        .where({ id: reference.id })
        .update({ needs_check: false, game_version: gameVersion ?? reference.game_version });
    }
    return { matched: range !== null, range, reference: await this.info(reference.id) };
  }

  async cues(userId: string, id: string): Promise<ReferenceCue[]> {
    const reference = await ownedReference(this.db, userId, id);
    const exercise = await ownedExercise(this.db, userId, reference.exercise_id);
    const muted = new Set(exercise.muted_cues);
    return (await this.analysisOf(reference)).events.map(event => ({
      key: event.key,
      kind: event.kind,
      sM: event.sM,
      endSM: event.endSM,
      targetSpeedKph: event.targetSpeedKph,
      phrase: eventPhrase(event, exercise.speak_targets),
      voice: event.voice,
      bigStop: event.bigStop,
      muted: muted.has(event.key),
      clip: clipKey(event.voice),
      followClip: targetClip(event),
      text: cueText(event.voice)
    }));
  }

  async clips(userId: string, id: string): Promise<string[]> {
    const { events, corners } = await this.analysisOf(await ownedReference(this.db, userId, id));
    return clipsOf(events, corners);
  }

  async corners(userId: string, id: string): Promise<CornerInfo[]> {
    const { corners, path } = await this.analysisOf(await ownedReference(this.db, userId, id));
    return cornerInfos(corners, path.lengthM);
  }

  async trace(userId: string, id: string): Promise<ReferenceTrace> {
    const { path, timeMs } = await this.analysisOf(await ownedReference(this.db, userId, id));
    const gridM = DEFAULT_CONFIG.reviewGridM;
    const count = Math.floor(path.lengthM / gridM + 1e-9) + 1;
    const points = Array.from({ length: count }, (_, index) => pointAt(path, index * gridM));
    const round = (value: number, digits: number) => Number(value.toFixed(digits));
    return {
      gridM,
      lengthM: path.lengthM,
      timeMs,
      x: points.map(point => round(point.position.x, 2)),
      z: points.map(point => round(point.position.z, 2)),
      speedMps: points.map(point => round(point.speedMps * KPH_PER_MPS, 1) / KPH_PER_MPS)
    };
  }

  private async store(source: ReferenceSource): Promise<ReferenceInfo> {
    const samples = await this.samplesOf(source.capture, source.range);
    try {
      buildReference(samples);
    } catch (error) {
      if (error instanceof ReferencePathError) throw new BadRequestException({ code: error.code, message: error.message });
      throw error;
    }
    const carId = carOf(samples);
    if (source.exercise.car_id !== null && carId !== null && carId !== source.exercise.car_id) {
      throw conflict('car-mismatch', `The range uses car ${carId}, but the exercise uses car ${source.exercise.car_id}.`);
    }
    const gameVersion = await this.settings.get('gameVersion');
    const id = await this.db.transaction(async trx => {
      const [row] = await trx('references')
        .insert({
          exercise_id: source.exercise.id,
          capture_id: source.capture.id,
          first_raw_index: source.range.first,
          last_raw_index: source.range.last,
          origin: source.origin,
          game_version: gameVersion,
          timer_ms: source.timerMs
        })
        .returning<{ id: string }[]>('id');
      await trx('exercises')
        .where({ id: source.exercise.id })
        .update({ active_reference_id: row!.id, car_id: source.exercise.car_id ?? carId });
      return row!.id;
    });
    return this.info(id);
  }

  private async timerRunOf(capture: CaptureRow, range: RawRange, session: GameTimerSession): Promise<TimerRunRange> {
    const run = cutToTimerRun(await this.samplesOf(capture), range, session);
    if (!run) throw badRequest('no-timer-run', 'The range does not hold the whole demonstration.');
    return run;
  }

  private async finishedCapture(userId: string, captureId: string): Promise<CaptureRow> {
    const capture = await ownedCapture(this.db, userId, captureId);
    if (capture.ended_at === null || this.captures.activeCaptureId === capture.id) {
      throw conflict('capture-active', 'Stop the capture before you use it.');
    }
    return capture;
  }

  private async info(id: string): Promise<ReferenceInfo> {
    const [row] = await this.listRows({ 'r.id': id });
    return referenceInfo(row!);
  }

  private listRows(where: Record<string, string>): Promise<ReferenceListRow[]> {
    return this.db('references as r')
      .join('exercises as e', 'e.id', 'r.exercise_id')
      .leftJoin('attempts as a', 'a.reference_id', 'r.id')
      .where(where)
      .groupBy('r.id', 'e.active_reference_id')
      .orderBy([{ column: 'r.created_at', order: 'desc' }, { column: 'r.id', order: 'desc' }])
      .select<ReferenceListRow[]>('r.*', this.db.raw('count(a.id)::int as attempt_count'), this.db.raw('coalesce(e.active_reference_id = r.id, false) as active'));
  }
}
