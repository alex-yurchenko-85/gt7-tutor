import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  Inject,
  Injectable,
  Logger,
  type BeforeApplicationShutdown,
  type OnModuleInit
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RawWriter, SampleStream, type Datagram, type OpenStream, type TelemetrySource } from '@gt7/capture';
import type { CaptureInfo, CapturePurpose, ReceptionCheck, Sample } from '@gt7/contracts';
import { decode } from '@gt7/core';
import type { Knex } from 'knex';
import { conflict } from '../http-errors.js';
import { MONO_CLOCK, type MonoClock } from '../clock/mono-clock.js';
import { ownedCapture, ownedExercise, type CaptureRow } from '../ownership/owned.js';
import { SettingsService } from '../settings/settings.service.js';
import { KNEX } from '../storage/knex.provider.js';
import { countRows } from './capture-samples.js';
import { TELEMETRY_SOURCE_FACTORY, type TelemetrySourceFactory } from './telemetry-source.factory.js';

export type SampleListener = (sample: Sample) => void;

export type CaptureRequest = { userId: string; exerciseId: string; purpose: CapturePurpose };

const RECEPTION_CHECK_MS = 2000;
const RECEPTION_ENOUGH_PACKETS = 30;

export const RAW_STREAM_OPENER = Symbol('RAW_STREAM_OPENER');

export type CaptureReservation = { readonly token: symbol };

type ActiveCapture = {
  id: string;
  userId: string;
  exerciseId: string;
  purpose: CapturePurpose;
  lastReceivedMono: number;
  source: TelemetrySource;
  writer: RawWriter;
  samples: SampleStream;
  startedMono: number;
};

export function captureInfo(row: CaptureRow, activeId: string | null): CaptureInfo {
  return {
    id: row.id,
    exerciseId: row.exercise_id,
    purpose: row.purpose,
    startedAt: row.started_at.toISOString(),
    endedAt: row.ended_at?.toISOString() ?? null,
    packets: row.packets,
    complete: row.complete,
    errorReason: row.error_reason,
    active: row.id === activeId
  };
}

function fileStamp(date: Date): string {
  return date.toISOString().replace(/[:.]/g, '-');
}

@Injectable()
export class CaptureService implements OnModuleInit, BeforeApplicationShutdown {
  private readonly logger = new Logger(CaptureService.name);
  private readonly dataDir: string;
  private readonly sourceKind: string;
  private readonly listeners = new Set<SampleListener>();
  private current: ActiveCapture | null = null;
  private reservation: CaptureReservation | null = null;

  constructor(
    @Inject(KNEX) private readonly db: Knex,
    @Inject(TELEMETRY_SOURCE_FACTORY) private readonly sourceFactory: TelemetrySourceFactory,
    private readonly settings: SettingsService,
    @Inject(MONO_CLOCK) private readonly clock: MonoClock,
    @Inject(RAW_STREAM_OPENER) private readonly openStream: OpenStream | null,
    config: ConfigService
  ) {
    this.dataDir = config.getOrThrow<string>('DATA_DIR');
    this.sourceKind = config.getOrThrow<string>('TELEMETRY_SOURCE');
  }

  async onModuleInit(): Promise<void> {
    const open = await this.db<CaptureRow>('captures').whereNull('ended_at');
    for (const row of open) {
      const packets = await this.readableRows(row.raw_path);
      await this.db('captures')
        .where({ id: row.id })
        .update({ ended_at: this.db.fn.now(), complete: false, error_reason: 'interrupted', packets });
    }
  }

  async beforeApplicationShutdown(): Promise<void> {
    if (this.current) await this.finish(this.current);
  }

  get activeCaptureId(): string | null {
    return this.current?.id ?? null;
  }

  get busy(): boolean {
    return this.current !== null || this.reservation !== null;
  }

  rawPath(row: Pick<CaptureRow, 'raw_path'>): string {
    return join(this.dataDir, row.raw_path);
  }

  get activeCapture(): { id: string; userId: string; exerciseId: string; purpose: CapturePurpose } | null {
    const current = this.current;
    return current ? { id: current.id, userId: current.userId, exerciseId: current.exerciseId, purpose: current.purpose } : null;
  }

  monoNow(): number | null {
    return this.current ? this.clock.now() - this.current.startedMono : null;
  }

  silenceMs(): number | null {
    return this.current ? this.clock.now() - this.current.lastReceivedMono : null;
  }

  hasReceived(): boolean {
    return (this.current?.writer.appended ?? 0) > 0;
  }

  incompleteReason(): string | null {
    return this.current?.writer.incompleteReason ?? null;
  }

  onSample(listener: SampleListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async list(userId: string): Promise<CaptureInfo[]> {
    const rows = await this.db<CaptureRow>('captures').where({ user_id: userId }).orderBy('started_at', 'desc');
    return rows.map(row => captureInfo(row, this.activeCaptureId));
  }

  reserve(): CaptureReservation {
    if (this.busy) throw conflict('busy', 'A capture or training is already active.');
    const reservation: CaptureReservation = { token: Symbol('capture') };
    this.reservation = reservation;
    return reservation;
  }

  release(reservation: CaptureReservation): void {
    if (this.reservation === reservation) this.reservation = null;
  }

  async begin(request: CaptureRequest): Promise<CaptureInfo> {
    await ownedExercise(this.db, request.userId, request.exerciseId);
    return this.beginReserved(request, this.reserve());
  }

  async beginReserved(request: CaptureRequest, reservation: CaptureReservation): Promise<CaptureInfo> {
    if (this.reservation !== reservation) throw conflict('busy', 'The capture reservation is no longer valid.');
    try {
      return await this.open(request);
    } finally {
      this.release(reservation);
    }
  }

  async checkReception(): Promise<ReceptionCheck> {
    const reservation = this.reserve();
    try {
      return await this.listenBriefly(await this.consoleAddress());
    } finally {
      this.release(reservation);
    }
  }

  async stop(userId: string, id: string): Promise<CaptureInfo> {
    const row = await ownedCapture(this.db, userId, id);
    if (this.current?.id !== row.id) throw conflict('not-active', 'This capture is not active.');
    return captureInfo(await this.finish(this.current), null);
  }

  private async consoleAddress(): Promise<string | null> {
    const ps5Ip = await this.settings.get('ps5Ip');
    if (this.sourceKind === 'udp' && ps5Ip === null) {
      throw conflict('console-address-missing', 'Enter the PS5 address in Setup before a capture.');
    }
    return ps5Ip;
  }

  private async listenBriefly(ps5Ip: string | null): Promise<ReceptionCheck> {
    const startedMono = this.clock.now();
    const result: ReceptionCheck = { packets: 0, decoded: 0, durationMs: 0, carId: null };
    let finish: () => void = () => undefined;
    const done = new Promise<void>(resolve => (finish = resolve));
    let source: TelemetrySource;
    try {
      source = this.sourceFactory({ ps5Ip, now: () => this.clock.now() - startedMono });
      await source.start(datagram => {
        result.packets++;
        const decoded = decode(datagram.payload);
        if (decoded.ok) {
          result.decoded++;
          result.carId ??= decoded.sample.carId;
        }
        if (result.packets >= RECEPTION_ENOUGH_PACKETS) finish();
      });
    } catch (error) {
      throw conflict('source-failed', error instanceof Error ? error.message : String(error));
    }
    const timer = setTimeout(finish, RECEPTION_CHECK_MS);
    await done;
    clearTimeout(timer);
    await source.stop();
    result.durationMs = Math.round(this.clock.now() - startedMono);
    return result;
  }

  private async open(request: CaptureRequest): Promise<CaptureInfo> {
    const ps5Ip = await this.consoleAddress();
    const id = randomUUID();
    const startedAt = new Date();
    const rawPath = join('raw', `${fileStamp(startedAt)}-${request.purpose}-${id.slice(0, 8)}.ndjson`);
    await mkdir(join(this.dataDir, 'raw'), { recursive: true });
    const [row] = await this.db<CaptureRow>('captures')
      .insert({
        id,
        user_id: request.userId,
        exercise_id: request.exerciseId,
        purpose: request.purpose,
        raw_path: rawPath,
        started_at: startedAt
      })
      .returning('*');
    const startedMono = this.clock.now();
    const writer = new RawWriter(join(this.dataDir, rawPath), id, this.openStream ? { open: this.openStream } : {});
    let source: TelemetrySource;
    try {
      source = this.sourceFactory({ ps5Ip, now: () => this.clock.now() - startedMono });
      const active: ActiveCapture = {
        id,
        userId: request.userId,
        exerciseId: request.exerciseId,
        purpose: request.purpose,
        lastReceivedMono: startedMono,
        source,
        writer,
        samples: new SampleStream({ warmupFrom: 0 }),
        startedMono
      };
      this.current = active;
      await source.start(datagram => this.receive(active, datagram));
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.current = null;
      await writer.close();
      await this.db('captures').where({ id }).update({ ended_at: this.db.fn.now(), complete: false, error_reason: `source-failed: ${reason}` });
      throw conflict('source-failed', reason);
    }
    return captureInfo(row!, id);
  }

  private receive(active: ActiveCapture, datagram: Datagram): void {
    active.lastReceivedMono = this.clock.now();
    const rawIndex = active.writer.append(datagram);
    const sample = active.samples.push({ rawIndex, receivedMonoMs: datagram.receivedMonoMs, payload: datagram.payload });
    if (!sample) return;
    for (const listener of this.listeners) {
      try {
        listener(sample);
      } catch (error) {
        this.logger.error(`Sample listener failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  private async finish(active: ActiveCapture): Promise<CaptureRow> {
    await active.source.stop();
    const result = await active.writer.close();
    if (this.current === active) this.current = null;
    const [row] = await this.db<CaptureRow>('captures')
      .where({ id: active.id })
      .update({ ended_at: this.db.fn.now(), packets: result.packets, complete: result.complete, error_reason: result.reason })
      .returning('*');
    return row!;
  }

  private async readableRows(rawPath: string): Promise<number> {
    const path = join(this.dataDir, rawPath);
    if (!existsSync(path)) return 0;
    try {
      return await countRows(path);
    } catch (error) {
      this.logger.warn(`Capture ${rawPath} has an unreadable row: ${error instanceof Error ? error.message : String(error)}`);
      return 0;
    }
  }
}
