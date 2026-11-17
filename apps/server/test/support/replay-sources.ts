import { ReplaySource, type TelemetrySource } from '@gt7/capture';
import type { TelemetrySourceFactory } from '../../src/captures/telemetry-source.factory.js';

export const fixturePath = (name: string) => new URL(`../../../../fixtures/${name}.ndjson`, import.meta.url).pathname;

export class FixtureReplays {
  readonly queue: (string | TelemetrySource)[] = [];
  last: ReplaySource | null = null;
  requests: { ps5Ip: string | null }[] = [];

  readonly factory: TelemetrySourceFactory = options => {
    this.requests.push({ ps5Ip: options.ps5Ip });
    const next = this.queue.shift();
    if (!next) throw new Error('No fixture queued for the replay source');
    if (typeof next !== 'string') return next;
    this.last = new ReplaySource({ path: fixturePath(next), speed: 0 });
    return this.last as TelemetrySource;
  };

  async finished(): Promise<void> {
    await this.last?.finished;
  }
}
