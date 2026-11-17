import { ReplaySource, UdpSource, type TelemetrySource } from '@gt7/capture';
import type { FactoryProvider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export const TELEMETRY_SOURCE_FACTORY = Symbol('TELEMETRY_SOURCE_FACTORY');

export type TelemetrySourceOptions = { ps5Ip: string | null; now: () => number };

export type TelemetrySourceFactory = (options: TelemetrySourceOptions) => TelemetrySource;

export type ReplayFile = { path: string; speed: number };

export class ReplayFileSelection {
  private selected: ReplayFile | null = null;
  private lastSource: ReplaySource | null = null;

  select(path: string, speed = 1): void {
    this.selected = { path, speed };
  }

  take(): ReplayFile {
    if (this.selected === null) throw new Error('No replay file is selected');
    return this.selected;
  }

  open(): ReplaySource {
    this.lastSource = new ReplaySource(this.take());
    return this.lastSource;
  }

  async lastReplayFinished(): Promise<void> {
    await this.lastSource?.finished;
  }
}

export const telemetrySourceFactoryProvider: FactoryProvider<TelemetrySourceFactory> = {
  provide: TELEMETRY_SOURCE_FACTORY,
  inject: [ConfigService, ReplayFileSelection],
  useFactory: (config: ConfigService, replayFiles: ReplayFileSelection): TelemetrySourceFactory => {
    if (config.getOrThrow<string>('TELEMETRY_SOURCE') === 'replay') {
      return () => replayFiles.open();
    }
    return ({ ps5Ip, now }) => {
      if (ps5Ip === null) throw new Error('The console address is not set');
      return new UdpSource({ ps5Ip, now });
    };
  }
};
