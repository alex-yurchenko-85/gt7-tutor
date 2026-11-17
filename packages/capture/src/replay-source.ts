import { setImmediate as yieldToEventLoop, setTimeout as delay } from 'node:timers/promises';
import type { RawDatagram } from '@gt7/contracts';
import type { Datagram, DatagramHandler, TelemetrySource } from './datagram.ts';
import { readRaw, type RawRange } from './raw-file.ts';

export type ReplaySourceOptions = { path: string; speed: number; range?: RawRange };

const ROWS_PER_YIELD = 256;

function toDatagram(row: RawDatagram): Datagram {
  return {
    payload: new Uint8Array(Buffer.from(row.payloadBase64, 'base64')),
    receivedMonoMs: row.receivedMonoMs,
    receivedUnixMs: row.receivedUnixMs,
    peerIp: row.peerIp
  };
}

export class ReplaySource implements TelemetrySource {
  private readonly options: ReplaySourceOptions;
  private stopped = false;
  private run: Promise<void> = Promise.resolve();

  constructor(options: ReplaySourceOptions) {
    if (!(options.speed >= 0)) throw new Error('Replay speed must be 0 or more');
    this.options = options;
  }

  get finished(): Promise<void> {
    return this.run;
  }

  async start(on: DatagramHandler): Promise<void> {
    this.stopped = false;
    this.run = this.replay(on);
    this.run.catch(() => undefined);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    await this.run.catch(() => undefined);
  }

  private async replay(on: DatagramHandler): Promise<void> {
    await yieldToEventLoop();
    const startedAt = performance.now();
    let firstMonoMs: number | null = null;
    let count = 0;
    for await (const row of readRaw(this.options.path, this.options.range)) {
      if (this.stopped) return;
      firstMonoMs ??= row.receivedMonoMs;
      await this.pace(row.receivedMonoMs - firstMonoMs, startedAt, ++count);
      if (this.stopped) return;
      on(toDatagram(row));
    }
  }

  private async pace(offsetMs: number, startedAt: number, count: number) {
    if (this.options.speed === 0) {
      if (count % ROWS_PER_YIELD === 0) await yieldToEventLoop();
      return;
    }
    const waitMs = startedAt + offsetMs / this.options.speed - performance.now();
    if (waitMs > 0) await delay(waitMs);
  }
}
