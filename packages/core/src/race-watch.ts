import type { Sample } from '@gt7/contracts';
import type { CoreConfig } from './config.ts';

export type RaceWatchState = 'waiting' | 'grid' | 'running' | 'finished' | 'ended';

export type RaceEndReason = 'session-left' | 'lap-counter-down';

export type RaceWatchEvent =
  | { type: 'grid'; rawIndex: number; lapsInRace: number }
  | { type: 'join'; rawIndex: number; lap: number; lapsInRace: number }
  | { type: 'start'; rawIndex: number }
  | { type: 'lap'; rawIndex: number; lap: number; lastLapMs: number }
  | { type: 'finish'; rawIndex: number }
  | { type: 'ended'; rawIndex: number; reason: RaceEndReason };

export class RaceWatch {
  private readonly config: CoreConfig['race'];
  private current: RaceWatchState = 'waiting';
  private currentLap = 0;
  private laps = 0;
  private sessionLostSinceMs: number | null = null;
  private noLapCountSinceMs: number | null = null;
  private noLapCount = false;
  private firstLap: number | null = null;

  constructor(config: CoreConfig) {
    this.config = config.race;
  }

  get state(): RaceWatchState {
    return this.current;
  }

  get lap(): number {
    return this.currentLap;
  }

  get lapsInRace(): number {
    return this.laps;
  }

  get unsupported(): boolean {
    return this.noLapCount;
  }

  get firstRecordedLap(): number | null {
    return this.firstLap;
  }

  push(sample: Sample): RaceWatchEvent[] {
    switch (this.current) {
      case 'waiting':
        return this.pushWaiting(sample);
      case 'grid':
      case 'running':
        return this.pushActive(sample);
      default:
        return [];
    }
  }

  private pushWaiting(sample: Sample): RaceWatchEvent[] {
    const race = sample.playerSession && sample.lapsInRace >= this.config.minLaps;
    if (race && sample.lap === 0) {
      this.begin('grid', sample, 1);
      return [{ type: 'grid', rawIndex: sample.rawIndex, lapsInRace: sample.lapsInRace }];
    }
    if (race && sample.lap >= 1 && sample.lap <= sample.lapsInRace) {
      this.begin('running', sample, sample.lap + 1);
      return [{ type: 'join', rawIndex: sample.rawIndex, lap: sample.lap, lapsInRace: sample.lapsInRace }];
    }
    this.watchLapCount(sample);
    return [];
  }

  private begin(state: 'grid' | 'running', sample: Sample, firstLap: number): void {
    this.current = state;
    this.currentLap = sample.lap;
    this.laps = sample.lapsInRace;
    this.firstLap = firstLap;
    this.noLapCount = false;
    this.noLapCountSinceMs = null;
    this.sessionLostSinceMs = null;
  }

  private watchLapCount(sample: Sample): void {
    if (!sample.playerSession || sample.lapsInRace >= this.config.minLaps || sample.lap < 0) {
      this.noLapCountSinceMs = null;
      this.noLapCount = false;
      return;
    }
    this.noLapCountSinceMs ??= sample.receivedMonoMs;
    if (sample.receivedMonoMs - this.noLapCountSinceMs > this.config.unsupportedAfterMs) this.noLapCount = true;
  }

  private pushActive(sample: Sample): RaceWatchEvent[] {
    if (!sample.playerSession) {
      this.sessionLostSinceMs ??= sample.receivedMonoMs;
      if (sample.receivedMonoMs - this.sessionLostSinceMs > this.config.sessionLostMs) return this.end(sample, 'session-left');
      return [];
    }
    this.sessionLostSinceMs = null;
    if (sample.lap < this.currentLap) return this.end(sample, 'lap-counter-down');
    if (sample.lap <= this.currentLap) return [];
    return this.current === 'grid' ? this.start(sample) : this.nextLap(sample);
  }

  private start(sample: Sample): RaceWatchEvent[] {
    this.current = 'running';
    this.currentLap = sample.lap;
    return [{ type: 'start', rawIndex: sample.rawIndex }];
  }

  private nextLap(sample: Sample): RaceWatchEvent[] {
    const events: RaceWatchEvent[] = [{ type: 'lap', rawIndex: sample.rawIndex, lap: this.currentLap, lastLapMs: sample.lastLapMs }];
    this.currentLap = sample.lap;
    if (sample.lap > this.laps) {
      this.current = 'finished';
      events.push({ type: 'finish', rawIndex: sample.rawIndex });
    }
    return events;
  }

  private end(sample: Sample, reason: RaceEndReason): RaceWatchEvent[] {
    this.current = 'ended';
    return [{ type: 'ended', rawIndex: sample.rawIndex, reason }];
  }
}
