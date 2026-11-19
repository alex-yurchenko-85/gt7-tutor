import { ConflictException, Inject, Injectable, Logger, ServiceUnavailableException, type BeforeApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ArmResponse, ArmTrainingRequest, ConnectionState, CueOutcome, LiveMode } from '@gt7/contracts';
import type { LiveCue } from '@gt7/contracts';
import { DEFAULT_CONFIG, buildCueEvents, findCorners, type Cue, type Finding, type Focus } from '@gt7/core';
import type { Knex } from 'knex';
import { CaptureService, type CaptureReservation } from '../captures/capture.service.js';
import { LiveHub, type ProfileState } from '../live/live-hub.service.js';
import { ownedExercise, type ReferenceRow } from '../ownership/owned.js';
import { ReferenceLocks } from '../references/reference-locks.js';
import { ReferencesService } from '../references/references.service.js';
import { KNEX } from '../storage/knex.provider.js';
import { FOCUS_ATTEMPTS, focusOf, recentFindings } from '../attempts/attempt-focus.js';
import { attemptFindings, storeAttempt, updateCueOutcome } from './attempt-store.js';
import { phraseDurations } from './phrase-durations.js';
import { TrainingSession, type AttemptRecord, type CueRecord, type TrainingSnapshot } from './training-session.js';

export const WATCHDOG_INTERVAL_MS = 50;
export const DISCONNECTED_AFTER_MS = 5000;
const ENDED_CUE_LIMIT = 500;

type Training = { userId: string; session: TrainingSession; unsubscribe: () => void; release: () => void };

type ArmPlan = {
  userId: string;
  request: ArmTrainingRequest;
  exerciseId: string;
  referenceId: string;
  mutedKeys: ReadonlySet<string>;
  speakTargets: boolean;
  offsetsMs: ReadonlyMap<string, number>;
  sideCueDistanceM: number | null;
  reservation: CaptureReservation;
};

type PendingArm = { userId: string; done: Promise<ArmResponse> };

type EndedCue = { userId: string; record: CueRecord; attemptId: string | null };

function conflict(code: string, reason: string): ConflictException {
  return new ConflictException({ code, reason });
}

function shuttingDown(): ServiceUnavailableException {
  return new ServiceUnavailableException({ code: 'shutting-down', reason: 'The server is stopping.' });
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
    private readonly locks: ReferenceLocks,
    private readonly hub: LiveHub,
    config: ConfigService
  ) {
    this.phraseMs = phraseDurations(config.getOrThrow<string>('AUDIO_DIR'));
    this.watchdog = setInterval(() => this.watch(), WATCHDOG_INTERVAL_MS);
  }

  onModuleInit(): void {
    this.hub.useStateSource(userId => this.profileState(userId));
    this.hub.onOutcome((userId, cueId, outcome, startDelayMs) => this.recordOutcome(userId, cueId, outcome, startDelayMs));
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
    if (this.training) throw conflict('busy', 'A capture or training is already active.');
    if (!exercise.active_reference_id) throw conflict('no-reference', 'Record and confirm a reference first.');
    if (request.mode === 'guided' && !this.hub.voiceReady(userId) && request.confirmNoVoice !== true) {
      throw conflict('voice-not-ready', 'No voice device is ready. Confirm to train without voice.');
    }
    const done = this.start({
      userId,
      request,
      exerciseId: exercise.id,
      referenceId: exercise.active_reference_id,
      mutedKeys: new Set(exercise.muted_cues),
      speakTargets: exercise.speak_targets,
      offsetsMs: new Map(Object.entries(exercise.cue_offsets)),
      sideCueDistanceM: exercise.side_cue_distance_m,
      reservation: this.captures.reserve()
    });
    const pending: PendingArm = { userId, done };
    this.pendingArm = pending;
    try {
      return await done;
    } finally {
      if (this.pendingArm === pending) this.pendingArm = null;
    }
  }

  private async start(plan: ArmPlan): Promise<ArmResponse> {
    const { userId, request, exerciseId, reservation } = plan;
    const release = await this.locks.hold(plan.referenceId);
    try {
      const reference = await this.db<ReferenceRow>('references').where({ id: plan.referenceId }).first();
      if (!reference) throw conflict('no-reference', 'Record and confirm a reference first.');
      const path = await this.references.pathOf(reference);
      if (this.stopping) throw shuttingDown();
      const snapshot: TrainingSnapshot = {
        userId,
        exerciseId,
        referenceId: reference.id,
        mode: request.mode,
        path,
        events: buildCueEvents(path, DEFAULT_CONFIG),
        mutedKeys: plan.mutedKeys,
        speakTargets: plan.speakTargets,
        offsetsMs: plan.offsetsMs,
        sideCueDistanceM: plan.sideCueDistanceM
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
      const training: Training = { userId, session, unsubscribe: this.captures.onSample(sample => session.onSample(sample)), release };
      this.training = training;
      try {
        const capture = await this.captures.beginReserved({ userId, exerciseId, purpose: 'player', startAfterS: null }, reservation, 'training');
        this.hub.changed();
        return { captureId: capture.id, exerciseId, referenceId: reference.id, mode: request.mode };
      } catch (error) {
        training.unsubscribe();
        this.training = null;
        throw error;
      }
    } catch (error) {
      release();
      throw error;
    } finally {
      this.captures.release(reservation);
    }
  }

  busyFor(userId: string): boolean {
    return this.training?.userId === userId || this.pendingArm?.userId === userId || this.captures.activeCapture?.userId === userId;
  }

  async disarm(userId: string): Promise<{ ok: true }> {
    const pending = this.pendingArm;
    if (pending?.userId === userId) await pending.done.catch(() => undefined);
    const training = this.ownTraining(userId);
    const now = this.captures.monoNow();
    if (training.session.attemptActive && now !== null) training.session.abortByUser(now);
    training.unsubscribe();
    this.training = null;
    this.storing = this.storing.then(training.release);
    const capture = this.captures.activeCapture;
    if (capture) await this.captures.stopForTraining(capture.id);
    this.hub.changed();
    return { ok: true };
  }

  profileState(userId: string): ProfileState {
    const capture = this.captures.activeCapture;
    const owner = this.training?.userId ?? capture?.userId ?? null;
    const neutral: ProfileState = {
      connection: 'disconnected',
      mode: 'idle',
      exerciseId: null,
      attemptNumber: null,
      generation: 0,
      guidance: { mode: 'active', reason: null },
      recordingComplete: true,
      storageError: null,
      sM: null,
      speedKph: null,
      lastCue: null,
      nextCue: null,
      lastAttemptId: this.lastAttemptIds.get(userId) ?? null,
      trainingMode: null,
      referenceId: null,
      gapMs: null
    };
    if (owner !== userId) return neutral;
    const storageError = this.captures.incompleteReason();
    const base = { ...neutral, connection: this.connection(), exerciseId: capture?.exerciseId ?? null, recordingComplete: storageError === null, storageError };
    if (!this.training) return { ...base, mode: 'capturing' };
    const view = this.training.session.state;
    return {
      ...base,
      exerciseId: this.training.session.snapshot.exerciseId,
      trainingMode: this.training.session.snapshot.mode,
      referenceId: this.training.session.snapshot.referenceId,
      mode: view.mode,
      attemptNumber: view.attemptNumber,
      generation: view.generation,
      guidance: view.guidance,
      sM: view.sM,
      speedKph: view.speedKph,
      lastCue: view.lastCue,
      nextCue: view.nextCue,
      gapMs: view.gapMs
    };
  }

  private ownTraining(userId: string): Training {
    if (!this.training || this.training.userId !== userId) throw conflict('not-armed', 'No training runs for this profile.');
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
    const signature = `${capture?.id ?? '-'}:${mode}:${this.connection()}:${this.captures.incompleteReason() ?? ''}`;
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
        const findings = attemptFindings(snapshot, record, DEFAULT_CONFIG);
        const focus = await this.focusCue(snapshot, record, findings);
        if (focus) ended.push({ userId: snapshot.userId, record: focus, attemptId: null });
        if (focus?.cueId) this.endedCues.set(focus.cueId, ended.at(-1)!);
        const cues = focus ? [...record.cues, focus] : record.cues;
        const stored = await storeAttempt(this.db, snapshot, captureId, { ...record, cues }, findings, DEFAULT_CONFIG);
        for (const entry of ended) entry.attemptId = stored.id;
        for (const [cue, outcome] of stored.storedOutcomes) {
          if (cue.cueId !== null && cue.outcome !== outcome) await updateCueOutcome(this.db, stored.id, cue);
        }
        this.lastAttemptIds.set(snapshot.userId, stored.id);
        this.hub.changed();
      })
      .catch((error: unknown) => this.logger.error(`Attempt not stored: ${error instanceof Error ? error.message : String(error)}`));
  }

  private async focusCue(snapshot: TrainingSnapshot, record: AttemptRecord, findings: Finding[]): Promise<CueRecord | null> {
    if (record.completion !== 'complete' || snapshot.mode !== 'guided') return null;
    const scope = { exerciseId: snapshot.exerciseId, referenceId: snapshot.referenceId, upTo: null };
    const previous = await recentFindings(this.db, scope, FOCUS_ATTEMPTS - 1);
    const focus = focusOf([findings, ...previous], findCorners(snapshot.path, snapshot.events, DEFAULT_CONFIG));
    if (!focus?.clip) return null;
    return this.speakFocus(snapshot.userId, record, focus, focus.clip);
  }

  private speakFocus(userId: string, record: AttemptRecord, focus: Focus, clip: string): CueRecord {
    const deviceDelayMs = this.hub.deviceDelayMs(userId);
    const cue: LiveCue = {
      id: `${record.generation}:focus`,
      eventKey: 'focus',
      kind: 'focus',
      targetSpeedKph: null,
      clip,
      followClip: null,
      generation: record.generation,
      priority: DEFAULT_CONFIG.cue.priority.system,
      decidedMonoMs: record.samples.at(-1)?.receivedMonoMs ?? 0,
      ttlMs: DEFAULT_CONFIG.cue.ttlBaseMs + deviceDelayMs
    };
    const busy = this.training?.userId === userId && this.training.session.attemptActive;
    const outcome = busy ? 'suppressed-during-attempt' : this.hub.sendCue(userId, cue) ? 'sent' : 'no-device';
    return {
      cueId: busy ? null : cue.id,
      eventKey: cue.eventKey,
      kind: cue.kind,
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
    while (this.endedCues.size > ENDED_CUE_LIMIT) this.endedCues.delete(this.endedCues.keys().next().value!);
  }
}
