import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';
import type { RawRange } from '@gt7/capture';
import type {
  CornerInfo,
  CreateReferenceRequest,
  ReferenceCheckResult,
  ReferenceCue,
  ReferenceInfo,
  ReferenceProposal,
  ReferenceTrace,
  Sample,
  StartKindName
} from '@gt7/contracts';
import {
  DEFAULT_CONFIG,
  ReferencePathError,
  buildCueEvents,
  buildReference,
  cueText,
  findCorners,
  findDemoRangeCandidates,
  KPH_PER_MPS,
  matchesReference,
  pointAt,
  speedWords,
  type Corner,
  type ReferenceCueEvent,
  type ReferencePath
} from '@gt7/core';
import type { Knex } from 'knex';
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

type ReferenceSource = {
  exercise: ExerciseRow;
  capture: CaptureRow;
  range: RawRange;
  startKind: StartKindName;
  origin: 'demo' | 'attempt';
};

type ReferenceListRow = ReferenceRow & { attempt_count: number; active: boolean };

function conflict(code: string, reason: string): ConflictException {
  return new ConflictException({ code, reason });
}

function referenceInfo(row: ReferenceListRow): ReferenceInfo {
  return {
    id: row.id,
    exerciseId: row.exercise_id,
    captureId: row.capture_id,
    first: row.first_raw_index,
    last: row.last_raw_index,
    origin: row.origin,
    startKind: row.start_kind,
    gameVersion: row.game_version,
    needsCheck: row.needs_check,
    active: row.active,
    attemptCount: row.attempt_count,
    createdAt: row.created_at.toISOString()
  };
}

function capitalized(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function spokenPhrase(event: ReferenceCueEvent, speakTargets: boolean): string {
  const action = cueText(event.voice);
  if (!speakTargets || event.kind !== 'brake' || event.targetSpeedKph === null) return action;
  return `${action}. ${capitalized(speedWords(event.targetSpeedKph))}`;
}

export function cornerInfo(corner: Corner): CornerInfo {
  return {
    number: corner.number,
    turnInSM: corner.turnInSM,
    apexSM: corner.apexSM,
    radiusM: corner.radiusM,
    apexSpeedKph: corner.apexSpeedKph
  };
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

  async samplesOf(capture: CaptureRow, range?: RawRange): Promise<Sample[]> {
    return this.samples.read(capture.id, this.captures.rawPath(capture), range);
  }

  async pathOf(reference: ReferenceRow): Promise<ReferencePath> {
    const capture = await this.db<CaptureRow>('captures').where({ id: reference.capture_id }).first();
    const samples = await this.samplesOf(capture!, { first: reference.first_raw_index, last: reference.last_raw_index });
    return buildReference(samples, reference.start_kind);
  }

  async proposals(userId: string, exerciseId: string, captureIds: string[]): Promise<ReferenceProposal[]> {
    await ownedExercise(this.db, userId, exerciseId);
    const captures = await Promise.all(captureIds.map(id => this.finishedCapture(userId, id)));
    const samples = await Promise.all(captures.map(capture => this.samplesOf(capture)));
    const candidates = findDemoRangeCandidates(
      samples,
      captures.map(capture => capture.start_cue_mono_ms)
    );
    return candidates.map(candidate => ({
      ranges: candidate.ranges.map((range, index) => ({ captureId: captures[index]!.id, first: range.first, last: range.last })),
      sampleCount: candidate.sampleCount,
      ambiguous: candidate.ambiguous,
      evidence: candidate.evidence
    }));
  }

  async create(userId: string, body: CreateReferenceRequest): Promise<ReferenceInfo> {
    const exercise = await ownedExercise(this.db, userId, body.exerciseId);
    const capture = await this.finishedCapture(userId, body.captureId);
    return this.store({ exercise, capture, range: { first: body.first, last: body.last }, startKind: body.startKind, origin: 'demo' });
  }

  async promote(userId: string, attemptId: string): Promise<ReferenceInfo> {
    const attempt = await ownedAttempt(this.db, userId, attemptId);
    if (attempt.completion !== 'complete') throw conflict('attempt-incomplete', 'Only a complete attempt can become a reference.');
    const exercise = await ownedExercise(this.db, userId, attempt.exercise_id);
    const capture = await this.finishedCapture(userId, attempt.capture_id);
    const used = await this.db<ReferenceRow>('references').where({ id: attempt.reference_id }).first();
    return this.store({
      exercise,
      capture,
      range: { first: attempt.first_raw_index, last: attempt.last_raw_index },
      startKind: used!.start_kind,
      origin: 'attempt'
    });
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
    const used = await this.db('attempts').where({ reference_id: reference.id }).first('id');
    if (used) throw conflict('reference-in-use', 'Attempts point to this reference. It cannot be deleted.');
    await this.db('references').where({ id: reference.id }).delete();
    return { ok: true };
  }

  async check(userId: string, id: string, captureId: string): Promise<ReferenceCheckResult> {
    const reference = await ownedReference(this.db, userId, id);
    const capture = await this.finishedCapture(userId, captureId);
    const range = matchesReference(await this.samplesOf(capture), await this.pathOf(reference));
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
    return buildCueEvents(await this.pathOf(reference), DEFAULT_CONFIG).map(event => ({
      key: event.key,
      kind: event.kind,
      sM: event.sM,
      endSM: event.endSM,
      targetSpeedKph: event.targetSpeedKph,
      phrase: spokenPhrase(event, exercise.speak_targets),
      voice: event.voice,
      bigStop: event.bigStop,
      muted: muted.has(event.key)
    }));
  }

  async corners(userId: string, id: string): Promise<CornerInfo[]> {
    const path = await this.pathOf(await ownedReference(this.db, userId, id));
    return findCorners(path, buildCueEvents(path, DEFAULT_CONFIG), DEFAULT_CONFIG).map(cornerInfo);
  }

  async trace(userId: string, id: string): Promise<ReferenceTrace> {
    const path = await this.pathOf(await ownedReference(this.db, userId, id));
    const gridM = DEFAULT_CONFIG.reviewGridM;
    const count = Math.floor(path.lengthM / gridM + 1e-9) + 1;
    const points = Array.from({ length: count }, (_, index) => pointAt(path, index * gridM));
    const round = (value: number, digits: number) => Number(value.toFixed(digits));
    return {
      gridM,
      lengthM: path.lengthM,
      timeMs: Math.round(path.points.at(-1)!.timeMs - path.points[0]!.timeMs),
      x: points.map(point => round(point.position.x, 2)),
      z: points.map(point => round(point.position.z, 2)),
      speedKph: points.map(point => round(point.speedMps * KPH_PER_MPS, 1))
    };
  }

  private async store(source: ReferenceSource): Promise<ReferenceInfo> {
    const samples = await this.samplesOf(source.capture, source.range);
    try {
      buildReference(samples, source.startKind);
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
          start_kind: source.startKind,
          game_version: gameVersion
        })
        .returning<{ id: string }[]>('id');
      await trx('exercises')
        .where({ id: source.exercise.id })
        .update({ active_reference_id: row!.id, car_id: source.exercise.car_id ?? carId });
      return row!.id;
    });
    return this.info(id);
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
