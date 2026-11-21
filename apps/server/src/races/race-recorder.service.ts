import { rm } from 'node:fs/promises';
import { Inject, Injectable, Logger, type BeforeApplicationShutdown } from '@nestjs/common';
import type { LiveRace, RecordRaceResponse, Sample, StopRaceResponse } from '@gt7/contracts';
import { DEFAULT_CONFIG, analyseRace } from '@gt7/core';
import type { Knex } from 'knex';
import { CaptureService } from '../captures/capture.service.js';
import { SampleCache } from '../captures/sample-cache.js';
import { CatalogueService } from '../catalogue/catalogue.service.js';
import { MONO_CLOCK, type MonoClock } from '../clock/mono-clock.js';
import { httpError } from '../http-errors.js';
import { LiveHub } from '../live/live-hub.service.js';
import type { CaptureRow } from '../ownership/owned.js';
import { KNEX } from '../storage/knex.provider.js';
import { LiveRaceTracker } from './live-race.js';
import { RaceStore, trackCandidateNames } from './race-store.js';

const RECORDER_WATCH_MS = 50;

export const RACE_SHUTDOWN_WAIT_MS = Symbol('RACE_SHUTDOWN_WAIT_MS');

export const SHUTDOWN_SAVE_WAIT_MS = 10000;

type LiveRaceMode = 'race-waiting' | 'race-running' | 'idle';

type Recording = {
  userId: string;
  captureId: string | null;
  tracker: LiveRaceTracker;
  finishedAtMono: number | null;
  endRequested: boolean;
  ending: Promise<StopRaceResponse> | null;
  unsubscribe: () => void;
  unkeep: () => void;
};

@Injectable()
export class RaceRecorder implements BeforeApplicationShutdown {
  private readonly logger = new Logger(RaceRecorder.name);
  private readonly leftovers = new Map<string, LiveRace>();
  private readonly lastRaceIds = new Map<string, string>();
  private readonly watchdog: NodeJS.Timeout;
  private readonly carName = (carId: number) => this.catalogue.carName(carId);
  private recording: Recording | null = null;
  private stopping = false;

  constructor(
    @Inject(KNEX) private readonly db: Knex,
    private readonly captures: CaptureService,
    private readonly samples: SampleCache,
    private readonly catalogue: CatalogueService,
    private readonly hub: LiveHub,
    private readonly store: RaceStore,
    @Inject(MONO_CLOCK) private readonly clock: MonoClock,
    @Inject(RACE_SHUTDOWN_WAIT_MS) private readonly shutdownWaitMs: number
  ) {
    this.watchdog = setInterval(() => this.watch(), RECORDER_WATCH_MS);
  }

  get busy(): boolean {
    return this.recording !== null;
  }

  busyFor(userId: string): boolean {
    return this.recording?.userId === userId;
  }

  lastRaceId(userId: string): string | null {
    return this.lastRaceIds.get(userId) ?? null;
  }

  signature(): string {
    const recording = this.recording;
    const race = recording?.tracker.live(this.carName);
    return `${race ? `${race.phase}:${race.lap}` : '-'}:${this.leftovers.size}`;
  }

  liveFor(userId: string): { mode: LiveRaceMode; race: LiveRace } | null {
    const recording = this.recording;
    if (recording?.userId === userId) {
      const race = recording.tracker.live(this.carName);
      return { mode: race.phase === 'waiting' ? 'race-waiting' : 'race-running', race };
    }
    const left = this.leftovers.get(userId);
    return left ? { mode: 'idle', race: left } : null;
  }

  async record(userId: string): Promise<RecordRaceResponse> {
    if (this.stopping) throw httpError(503, 'shutting-down');
    if (this.recording) throw httpError(409, 'busy');
    const reservation = this.captures.reserve();
    const recording: Recording = {
      userId,
      captureId: null,
      tracker: new LiveRaceTracker(DEFAULT_CONFIG),
      finishedAtMono: null,
      endRequested: false,
      ending: null,
      unsubscribe: () => undefined,
      unkeep: () => undefined
    };
    recording.unsubscribe = this.captures.onSample(sample => this.onSample(recording, sample));
    this.recording = recording;
    try {
      const capture = await this.captures.beginReserved({ userId, exerciseId: null, purpose: 'race' }, reservation);
      recording.captureId = capture.id;
      this.leftovers.delete(userId);
      recording.unkeep = this.captures.keep(capture.id);
      this.hub.changed();
      return { captureId: capture.id };
    } catch (error) {
      recording.unsubscribe();
      this.recording = null;
      this.hub.changed();
      throw error;
    }
  }

  stop(userId: string): Promise<StopRaceResponse> {
    const recording = this.recording;
    if (!recording || recording.userId !== userId || recording.captureId === null) {
      return Promise.reject(httpError(409, 'not-recording'));
    }
    return this.end(recording);
  }

  forgetRaces(userId: string, raceIds: string[]): void {
    const removed = new Set(raceIds);
    const left = this.leftovers.get(userId);
    const lastRaceId = this.lastRaceIds.get(userId);
    if (left?.savedRaceId && removed.has(left.savedRaceId)) this.leftovers.delete(userId);
    if (lastRaceId && removed.has(lastRaceId)) this.lastRaceIds.delete(userId);
    this.hub.changed();
  }

  close(userId: string): { ok: true } {
    if (this.leftovers.delete(userId)) this.hub.changed();
    return { ok: true };
  }

  async beforeApplicationShutdown(): Promise<void> {
    this.stopping = true;
    clearInterval(this.watchdog);
    const recording = this.recording;
    if (!recording) return;
    if (recording.captureId === null) {
      recording.unsubscribe();
      recording.unkeep();
      this.recording = null;
      return;
    }
    let timer: NodeJS.Timeout | undefined;
    const waited = new Promise<'late'>(resolve => (timer = setTimeout(() => resolve('late'), this.shutdownWaitMs)));
    const saved = this.end(recording).then(
      () => 'saved' as const,
      () => 'failed' as const
    );
    const outcome = await Promise.race([saved, waited]);
    clearTimeout(timer);
    if (outcome === 'saved') return;
    if (outcome === 'late') this.logger.warn(`The race can be missing: the save took more than ${this.shutdownWaitMs} ms.`);
    await this.db('captures').where({ id: recording.captureId }).update({ complete: false, error_reason: 'interrupted' });
  }

  private onSample(recording: Recording, sample: Sample): void {
    if (this.recording !== recording || recording.ending) return;
    const outcome = recording.tracker.push(sample);
    if (outcome === 'finish') recording.finishedAtMono = this.clock.now();
    if (outcome === 'ended') recording.endRequested = true;
    this.hub.changed();
  }

  private watch(): void {
    const recording = this.recording;
    if (recording && recording.captureId !== null && !recording.ending && this.shouldEnd(recording)) this.end(recording).catch(() => undefined);
    const capture = this.captures.activeCapture;
    const opening = recording !== null && recording.captureId === null;
    if (capture && !opening && capture.id !== recording?.captureId && this.leftovers.delete(capture.userId)) this.hub.changed();
  }

  private shouldEnd(recording: Recording): boolean {
    if (recording.endRequested) return true;
    if (recording.finishedAtMono !== null) return this.clock.now() - recording.finishedAtMono >= DEFAULT_CONFIG.race.afterFinishMs;
    return recording.tracker.active && (this.captures.silenceMs() ?? 0) > DEFAULT_CONFIG.race.silenceEndMs;
  }

  private end(recording: Recording): Promise<StopRaceResponse> {
    recording.ending ??= this.finish(recording);
    return recording.ending;
  }

  private async finish(recording: Recording): Promise<StopRaceResponse> {
    recording.unsubscribe();
    const race = recording.tracker.live(this.carName);
    let raceId: string | null = null;
    let failed = false;
    try {
      raceId = await this.save(recording.userId, recording.captureId!);
    } catch (error) {
      failed = true;
      this.logger.error(`Race not stored: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    } finally {
      recording.unkeep();
      this.recording = null;
      if (failed || race.phase !== 'waiting' || raceId !== null) {
        this.leftovers.set(recording.userId, { ...race, phase: race.phase === 'finished' && raceId !== null ? 'finished' : 'stopped', savedRaceId: raceId });
      }
      this.hub.changed();
    }
    return { raceId };
  }

  private async save(userId: string, captureId: string): Promise<string | null> {
    if (this.captures.activeCapture?.id === captureId) await this.captures.stop(userId, captureId);
    const row = (await this.db<CaptureRow>('captures').where({ id: captureId }).first())!;
    const path = this.captures.rawPath(row);
    const samples = await this.samples.read(captureId, path);
    const analysis = analyseRace(samples, DEFAULT_CONFIG);
    if (analysis === null) {
      await this.db('captures').where({ id: captureId }).delete();
      this.samples.forget(captureId);
      await rm(path, { force: true });
      return null;
    }
    const raceId = await this.store.save(userId, captureId, analysis, trackCandidateNames(analysis, this.catalogue.active.circuits), samples);
    this.lastRaceIds.set(userId, raceId);
    return raceId;
  }
}
