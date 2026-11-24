import { HttpException, Inject, Injectable, Logger, type BeforeApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ENGLISH, type ArmResponse, type ArmTrainingRequest, type ConnectionState, type CueOutcome, type LiveMode } from '@gt7/contracts';
import { ACTIVE_GUIDANCE, DEFAULT_CONFIG, focusFor, makeCue, type CoachSettings, type Cue, type FocusAttempt } from '@gt7/core';
import type { Knex } from 'knex';
import { CaptureService, type CaptureReservation } from '../captures/capture.service.js';
import { httpError } from '../http-errors.js';
import { dropOldest } from '../drop-oldest.js';
import { LiveHub, type ProfileState } from '../live/live-hub.service.js';
import { ownedExercise, type ReferenceRow } from '../ownership/owned.js';
import { RaceRecorder } from '../races/race-recorder.service.js';
import { ReferencesService } from '../references/references.service.js';
import { KNEX } from '../storage/knex.provider.js';
import { attemptComparison, storeAttempt, updateCueOutcome } from './attempt-store.js';
import { phraseDurations } from './phrase-durations.js';
import { TrainingSession, type AttemptRecord, type CueRecord, type TrainingSnapshot } from './training-session.js';

export const WATCHDOG_INTERVAL_MS = 50;
export const DISCONNECTED_AFTER_MS = 5000;
const ENDED_CUE_LIMIT = 500;

type Training = { userId: string; session: TrainingSession; unsubscribe: () => void };

type ArmPlan = {
  userId: string;
  request: ArmTrainingRequest;
  exerciseId: string;
  referenceId: string;
  settings: CoachSettings;
  reservation: CaptureReservation;
};

type PendingArm = { userId: string; referenceId: string; done: Promise<ArmResponse> };

type EndedCue = { userId: string; record: CueRecord; attemptId: string | null };

function shuttingDown(): HttpException {
  return httpError(503, 'shutting-down');
}

@Injectable()
export class TrainingService implements OnModuleInit, BeforeApplicationShutdown {
  private readonly logger = new Logger(TrainingService.name);
  private readonly phraseMs: (clip: string) => number;
  private readonly lastAttemptIds = new Map<string, string>();
  private readonly endedCues = new Map<string, EndedCue>();
  private readonly watchdog: NodeJS.Timeout;
  private training: Training | null = null;
  private pendingArm: PendingArm | null = null;
  private stopping = false;
  private storing: Promise<void> = Promise.resolve();
  private lastSignature = '';

  constructor(
    @Inject(KNEX) private readonly db: Knex,
    private readonly captures: CaptureService,
    private readonly references: ReferencesService,
    private readonly hub: LiveHub,
    private readonly races: RaceRecorder,
    config: ConfigService
  ) {
    this.phraseMs = phraseDurations(config.getOrThrow<string>('AUDIO_DIR'), ENGLISH.lang);
    this.watchdog = setInterval(() => this.watch(), WATCHDOG_INTERVAL_MS);
  }

  onModuleInit(): void {
    this.hub.useStateSource(userId => this.profileState(userId));
    this.hub.onOutcome((userId, cueId, outcome, startDelayMs) => this.recordOutcome(userId, cueId, outcome, startDelayMs));
    this.references.useDeleteGate((userId, referenceId) => this.beforeReferenceDelete(userId, referenceId));
  }

  async beforeApplicationShutdown(): Promise<void> {
    this.stopping = true;
    clearInterval(this.watchdog);
    await this.pendingArm?.done.catch(() => undefined);
    if (this.training) await this.disarm(this.training.userId);
    await this.storing;
  }

  idle(): Promise<void> {
    return this.storing;
  }

  async arm(userId: string, request: ArmTrainingRequest): Promise<ArmResponse> {
    if (this.stopping) throw shuttingDown();
    const exercise = await ownedExercise(this.db, userId, request.exerciseId);
    if (this.training || this.races.busy) throw httpError(409, 'busy');
    if (!exercise.active_reference_id) throw httpError(409, 'no-reference');
    const done = this.start({
      userId,
      request,
      exerciseId: exercise.id,
      referenceId: exercise.active_reference_id,
      settings: {
        mutedKeys: new Set(exercise.muted_cues),
        speakTargets: exercise.speak_targets,
        offsetsMs: new Map(Object.entries(exercise.cue_offsets)),
        sideCueDistanceM: exercise.side_cue_distance_m
      },
      reservation: this.captures.reserve()
    });
    const pending: PendingArm = { userId, referenceId: exercise.active_reference_id, done };
    this.pendingArm = pending;
    try {
      return await done;
    } finally {
      if (this.pendingArm === pending) this.pendingArm = null;
    }
  }

  private async start(plan: ArmPlan): Promise<ArmResponse> {
    const { userId, request, exerciseId, reservation } = plan;
    try {
      const reference = (await this.db<ReferenceRow>('references').where({ id: plan.referenceId }).first())!;
      const analysis = await this.references.analysisOf(reference);
      await this.storing;
      if (this.stopping) throw shuttingDown();
      const stored = await this.db('attempts').where({ exercise_id: exerciseId }).count<{ count: string }>({ count: '*' }).first();
      const snapshot: TrainingSnapshot = {
        userId,
        exerciseId,
        referenceId: reference.id,
        analysis,
        storedAttempts: Number(stored!.count),
        ...plan.settings
      };
      const session = new TrainingSession(snapshot, DEFAULT_CONFIG, {
        deviceDelayMs: () => this.hub.deviceDelayMs(userId),
        phraseMs: clip => this.phraseMs(clip),
        nextGeneration: () => this.hub.nextGeneration(),
        sendCue: (cue: Cue) => this.hub.sendCue(userId, cue),
        cancel: generation => this.hub.cancel(userId, generation),
        attemptEnded: record => this.attemptEnded(snapshot, record),
        changed: () => this.hub.changed()
      });
      const training: Training = { userId, session, unsubscribe: this.captures.onSample(sample => session.onSample(sample)) };
      this.training = training;
      try {
        const capture = await this.captures.beginReserved({ userId, exerciseId, purpose: 'player' }, reservation);
        this.hub.changed();
        return { captureId: capture.id, exerciseId, referenceId: reference.id };
      } catch (error) {
        training.unsubscribe();
        this.training = null;
        throw error;
      }
    } finally {
      this.captures.release(reservation);
    }
  }

  busyFor(userId: string): boolean {
    return (
      this.training?.userId === userId ||
      this.pendingArm?.userId === userId ||
      this.captures.activeCapture?.userId === userId ||
      this.races.busyFor(userId)
    );
  }

  async disarm(userId: string): Promise<{ ok: true }> {
    const pending = this.pendingArm;
    if (pending?.userId === userId) await pending.done.catch(() => undefined);
    const training = this.ownTraining(userId);
    const now = this.captures.monoNow();
    if (training.session.attemptActive && now !== null) training.session.abortByUser(now);
    training.unsubscribe();
    this.training = null;
    const capture = this.captures.activeCapture;
    if (capture) await this.captures.stop(userId, capture.id);
    this.hub.changed();
    return { ok: true };
  }

  private async beforeReferenceDelete(userId: string, referenceId: string): Promise<void> {
    const uses = [this.training?.session.snapshot, this.pendingArm].some(use => use?.userId === userId && use.referenceId === referenceId);
    if (uses) throw httpError(409, 'reference-in-training');
    await this.storing;
  }

  profileState(userId: string): ProfileState {
    const capture = this.captures.activeCapture;
    const owner = this.training?.userId ?? capture?.userId ?? null;
    const race = this.races.liveFor(userId);
    const neutral: ProfileState = {
      connection: 'disconnected',
      mode: 'idle',
      exerciseId: null,
      attemptNumber: null,
      generation: 0,
      guidance: ACTIVE_GUIDANCE,
      recordingComplete: true,
      storageError: null,
      sM: null,
      speedMps: null,
      lastCue: null,
      nextCue: null,
      lastAttemptId: this.lastAttemptIds.get(userId) ?? null,
      referenceId: null,
      gapMs: null,
      startMissed: false,
      lastRaceId: this.races.lastRaceId(userId),
      race: null
    };
    if (owner !== userId) return race ? { ...neutral, mode: race.mode, race: race.race } : neutral;
    const storageError = this.captures.incompleteReason();
    const base = { ...neutral, connection: this.connection(), exerciseId: capture?.exerciseId ?? null, recordingComplete: storageError === null, storageError };
    if (!this.training) return race && race.mode !== 'idle' ? { ...base, mode: race.mode, race: race.race } : { ...base, mode: 'capturing' };
    const view = this.training.session.state;
    const { exerciseId, referenceId } = this.training.session.snapshot;
    return { ...base, ...view, exerciseId, referenceId };
  }

  private ownTraining(userId: string): Training {
    if (!this.training || this.training.userId !== userId) throw httpError(409, 'not-armed');
    return this.training;
  }

  private connection(): ConnectionState {
    const silence = this.captures.silenceMs();
    if (silence === null || silence > DISCONNECTED_AFTER_MS) return 'disconnected';
    if (!this.captures.hasReceived()) return 'stale';
    return silence > DEFAULT_CONFIG.freshnessMs ? 'stale' : 'connected';
  }

  private watch(): void {
    const now = this.captures.monoNow();
    if (this.training && now !== null) this.training.session.tick(now);
    const capture = this.captures.activeCapture;
    const mode: LiveMode | 'none' = this.training?.session.state.mode ?? (capture ? 'capturing' : 'none');
    const signature = `${capture?.id ?? '-'}:${mode}:${this.races.signature()}:${this.connection()}:${this.captures.incompleteReason() ?? ''}`;
    if (signature !== this.lastSignature) this.hub.changed();
    this.lastSignature = signature;
  }

  private attemptEnded(snapshot: TrainingSnapshot, record: AttemptRecord): void {
    const captureId = this.captures.activeCapture?.id;
    if (!captureId) {
      this.logger.error('An attempt ended without an active capture; it is not stored');
      return;
    }
    const ended = record.cues.filter(cue => cue.cueId !== null).map((cue): EndedCue => ({ userId: snapshot.userId, record: cue, attemptId: null }));
    for (const entry of ended) this.endedCues.set(entry.record.cueId!, entry);
    this.trimEndedCues();
    this.storing = this.storing
      .then(async () => {
        const comparison = attemptComparison(snapshot, record, DEFAULT_CONFIG);
        const focus = this.focusCue(snapshot, record, comparison);
        if (focus) ended.push({ userId: snapshot.userId, record: focus, attemptId: null });
        if (focus?.cueId) this.endedCues.set(focus.cueId, ended.at(-1)!);
        const cues = focus ? [...record.cues, focus] : record.cues;
        const stored = await storeAttempt(this.db, snapshot, captureId, { ...record, cues }, comparison);
        for (const entry of ended) entry.attemptId = stored.id;
        for (const [cue, outcome] of stored.storedOutcomes) {
          if (cue.cueId !== null && cue.outcome !== outcome) await updateCueOutcome(this.db, stored.id, cue);
        }
        this.lastAttemptIds.set(snapshot.userId, stored.id);
        this.hub.changed();
      })
      .catch((error: unknown) => this.logger.error(`Attempt not stored: ${error instanceof Error ? error.message : String(error)}`));
  }

  private focusCue(snapshot: TrainingSnapshot, record: AttemptRecord, comparison: FocusAttempt): CueRecord | null {
    if (record.completion !== 'complete') return null;
    const focus = focusFor(comparison, DEFAULT_CONFIG);
    if (!focus?.clip) return null;
    return this.speakFocus(snapshot.userId, record, focus.clip);
  }

  private speakFocus(userId: string, record: AttemptRecord, clip: string): CueRecord {
    const deviceDelayMs = this.hub.deviceDelayMs(userId);
    const cue = makeCue(
      {
        kind: 'focus',
        generation: record.generation,
        eventKey: 'focus',
        clip,
        followClip: null,
        targetSpeedKph: null,
        decidedMonoMs: record.samples.at(-1)?.receivedMonoMs ?? 0,
        deviceDelayMs
      },
      DEFAULT_CONFIG
    );
    const busy = this.training?.userId === userId && this.training.session.attemptActive;
    const outcome = busy ? 'suppressed-during-attempt' : this.hub.sendCue(userId, cue) ? 'sent' : 'no-device';
    return {
      cueId: busy ? null : cue.id,
      eventKey: cue.eventKey,
      kind: cue.kind,
      eventKind: 'focus',
      sM: null,
      targetKph: null,
      decidedMonoMs: cue.decidedMonoMs,
      outcome,
      startDelayMs: null,
      deviceDelayMs
    };
  }

  private recordOutcome(userId: string, cueId: string, outcome: CueOutcome, startDelayMs: number | null): void {
    if (this.training?.userId === userId && this.training.session.recordOutcome(cueId, outcome, startDelayMs) && !this.endedCues.has(cueId)) return;
    const ended = this.endedCues.get(cueId);
    if (!ended || ended.userId !== userId) return;
    ended.record.outcome = outcome;
    ended.record.startDelayMs = startDelayMs;
    if (ended.attemptId === null) return;
    const attemptId = ended.attemptId;
    this.storing = this.storing
      .then(() => updateCueOutcome(this.db, attemptId, ended.record))
      .catch((error: unknown) => this.logger.error(`Cue outcome not stored: ${error instanceof Error ? error.message : String(error)}`));
  }

  private trimEndedCues(): void {
    dropOldest(this.endedCues, ENDED_CUE_LIMIT);
  }
}
