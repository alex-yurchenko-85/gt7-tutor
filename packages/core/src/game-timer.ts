import type { Sample } from '@gt7/contracts';
import { DEFAULT_CONFIG, type CoreConfig } from './config.ts';
import { isRepeatedPacket } from './sequence.ts';

export type GameTimerEvent = {
  type: 'started' | 'finished' | 'left-track' | 'restart';
  rawIndex: number;
  gameTimeMs: number;
};

export type GameTimerSession = 'player' | 'demonstration';

export type GameTimerWatchOptions = { session: GameTimerSession; config?: CoreConfig };

export class GameTimerWatch {
  private readonly session: GameTimerSession;
  private readonly config: CoreConfig;
  private running = false;
  private previousTimerMs: number | null = null;
  private lastPacketId = 0;
  private valueMs = 0;
  private valueRawIndex = 0;
  private stillPackets = 0;

  constructor(options: GameTimerWatchOptions = { session: 'player' }) {
    this.session = options.session;
    this.config = options.config ?? DEFAULT_CONFIG;
  }

  get active(): boolean {
    return this.running;
  }

  step(sample: Sample): GameTimerEvent | null {
    const previousTimerMs = this.previousTimerMs;
    this.previousTimerMs = sample.gameTimerMs;
    return this.running ? this.stepActive(sample) : this.stepInactive(sample, previousTimerMs);
  }

  reset(): void {
    this.running = false;
    this.previousTimerMs = null;
    this.stillPackets = 0;
  }

  private stepInactive(sample: Sample, previousTimerMs: number | null): GameTimerEvent | null {
    const timerMs = sample.gameTimerMs;
    if (!this.countsFor(sample) || previousTimerMs !== 0) return null;
    if (timerMs < 1 || timerMs > this.config.gameTimer.startMaxMs) return null;
    this.running = true;
    this.lastPacketId = sample.packetId;
    this.valueMs = timerMs;
    this.valueRawIndex = sample.rawIndex;
    this.stillPackets = 0;
    return { type: 'started', rawIndex: sample.rawIndex, gameTimeMs: timerMs };
  }

  private stepActive(sample: Sample): GameTimerEvent | null {
    if (isRepeatedPacket(this.lastPacketId, sample.packetId)) return null;
    this.lastPacketId = sample.packetId;
    const timerMs = sample.gameTimerMs;
    if (timerMs === -1) return this.end('left-track', sample);
    if (timerMs === 0) return this.end('restart', sample);
    if (timerMs > this.valueMs) {
      this.valueMs = timerMs;
      this.valueRawIndex = sample.rawIndex;
      this.stillPackets = 0;
      return null;
    }
    if (sample.paused) {
      this.stillPackets = 0;
      return null;
    }
    this.stillPackets += 1;
    if (this.stillPackets < this.config.gameTimer.stillPackets) return null;
    this.running = false;
    return { type: 'finished', rawIndex: this.valueRawIndex, gameTimeMs: this.valueMs };
  }

  private countsFor(sample: Sample): boolean {
    return sample.playerSession === (this.session === 'player');
  }

  private end(type: 'left-track' | 'restart', sample: Sample): GameTimerEvent {
    this.running = false;
    return { type, rawIndex: sample.rawIndex, gameTimeMs: sample.gameTimerMs };
  }
}
