import type { Sample } from '@gt7/contracts';
import type { CoreConfig } from './config.ts';
import { GameTimerWatch, type GameTimerEvent } from './game-timer.ts';
import { distance } from './geometry.ts';
import { clockOf } from './packet-clock.ts';

export type AttemptEventType = 'started' | 'paused' | 'resumed' | 'finished' | 'aborted';

export type AttemptEvent = {
  type: AttemptEventType;
  rawIndex: number | null;
  atMonoMs: number;
  atClockMs: number;
  reason: string | null;
  gameTimeMs: number | null;
  generation: number;
};

export type AttemptState = 'waiting' | 'driving' | 'paused' | 'finished';

export type PositionBreak = 'car-changed' | 'discontinuity';

type Break = 'silence' | PositionBreak;

type TimerValue = { timerMs: number; atMonoMs: number; atClockMs: number };

const GAME_TIMER_REASON = 'game-timer';

export function hasPlayerControl(sample: Sample): boolean {
  return sample.playerSession && !sample.paused && !sample.loading;
}

export function positionBreak(previous: Sample, current: Sample, config: CoreConfig): PositionBreak | null {
  const elapsedMs = Math.max(0, current.receivedMonoMs - previous.receivedMonoMs);
  if (previous.carId !== current.carId) return 'car-changed';
  const expectedM = (Math.max(previous.speedMps, current.speedMps) * elapsedMs) / 1000;
  if (distance(previous.position, current.position) > expectedM + config.discontinuityMarginM) return 'discontinuity';
  return null;
}

export function continuityBreak(previous: Sample, current: Sample, config: CoreConfig): Break | null {
  if (current.receivedMonoMs - previous.receivedMonoMs > config.silenceGapMs) return 'silence';
  return positionBreak(previous, current, config);
}

function timerValueOf(sample: Sample): TimerValue {
  return { timerMs: sample.gameTimerMs, atMonoMs: sample.receivedMonoMs, atClockMs: clockOf(sample) };
}

export class AttemptTracker {
  private readonly config: CoreConfig;
  private readonly watch = new GameTimerWatch();
  private current: AttemptState = 'waiting';
  private generation = 0;
  private last: Sample | null = null;
  private lastRawIndex: number | null = null;
  private lastEvidenceMonoMs: number | null = null;
  private clockOffsetMs = 0;
  private finalValue: TimerValue = { timerMs: 0, atMonoMs: 0, atClockMs: 0 };

  constructor(config: CoreConfig) {
    this.config = config;
  }

  get state(): AttemptState {
    return this.current;
  }

  step(sample: Sample): AttemptEvent[] {
    const silence = this.silenceBefore(sample.receivedMonoMs);
    const previous = this.last;
    this.last = sample;
    this.lastRawIndex = sample.rawIndex;
    this.lastEvidenceMonoMs = sample.receivedMonoMs;
    this.clockOffsetMs = clockOf(sample) - sample.receivedMonoMs;
    const timer = this.stepWatch(sample);
    if (silence) return [silence];
    if (this.isActive()) return this.stepActive(previous, sample, timer);
    return timer?.type === 'started' ? [this.timerStart(sample)] : [];
  }

  tick(nowMonoMs: number): AttemptEvent[] {
    const silence = this.silenceBefore(nowMonoMs);
    return silence ? [silence] : [];
  }

  abortByUser(nowMonoMs: number): AttemptEvent[] {
    return this.isActive() ? [this.abort('manual', this.lastRawIndex, nowMonoMs)] : [];
  }

  reset(): void {
    this.current = 'waiting';
    this.last = null;
    this.lastRawIndex = null;
    this.lastEvidenceMonoMs = null;
    this.watch.reset();
  }

  private stepWatch(sample: Sample): GameTimerEvent | null {
    const timer = this.watch.step(sample);
    if (timer?.type === 'started') this.finalValue = timerValueOf(sample);
    else if (this.watch.active && sample.gameTimerMs > this.finalValue.timerMs) this.finalValue = timerValueOf(sample);
    return timer;
  }

  private stopWatch(): void {
    if (this.watch.active) this.watch.reset();
  }

  private silenceBefore(nowMonoMs: number): AttemptEvent | null {
    const evidenceMs = this.lastEvidenceMonoMs;
    if (!this.isActive() || evidenceMs === null || nowMonoMs - evidenceMs <= this.config.silenceGapMs) return null;
    return this.abort('silence', this.lastRawIndex, evidenceMs + this.config.silenceGapMs);
  }

  private isActive(): boolean {
    return this.current === 'driving' || this.current === 'paused';
  }

  private stepActive(previous: Sample | null, sample: Sample, timer: GameTimerEvent | null): AttemptEvent[] {
    if (!sample.playerSession) return [this.abort('player-session-ended', sample.rawIndex, sample.receivedMonoMs)];
    if (timer?.type === 'left-track' || timer?.type === 'restart') return [this.abort(timer.type, sample.rawIndex, sample.receivedMonoMs)];
    const broken = previous ? continuityBreak(previous, sample, this.config) : null;
    if (broken) return [this.abort(broken, sample.rawIndex, sample.receivedMonoMs)];
    if (sample.loading) return [this.abort('loading', sample.rawIndex, sample.receivedMonoMs)];
    if (this.current === 'paused') {
      if (sample.paused) return [];
      this.current = 'driving';
      return [this.event('resumed', sample.rawIndex, sample.receivedMonoMs, null)];
    }
    if (sample.paused) {
      this.current = 'paused';
      return [this.event('paused', sample.rawIndex, sample.receivedMonoMs, null)];
    }
    return timer?.type === 'finished' ? [this.timerFinish(timer)] : [];
  }

  private timerStart(sample: Sample): AttemptEvent {
    const timerMs = sample.gameTimerMs;
    this.generation += 1;
    this.current = 'driving';
    return this.event('started', sample.rawIndex, sample.receivedMonoMs - timerMs, GAME_TIMER_REASON, clockOf(sample) - timerMs);
  }

  private timerFinish(timer: GameTimerEvent): AttemptEvent {
    this.current = 'finished';
    const { atMonoMs, atClockMs } = this.finalValue;
    return { ...this.event('finished', timer.rawIndex, atMonoMs, GAME_TIMER_REASON, atClockMs), gameTimeMs: timer.gameTimeMs };
  }

  private abort(reason: string, rawIndex: number | null, atMonoMs: number): AttemptEvent {
    this.current = 'waiting';
    this.stopWatch();
    return this.event('aborted', rawIndex, atMonoMs, reason);
  }

  private event(type: AttemptEventType, rawIndex: number | null, atMonoMs: number, reason: string | null, atClockMs = atMonoMs + this.clockOffsetMs): AttemptEvent {
    return { type, rawIndex, atMonoMs, atClockMs, reason, gameTimeMs: null, generation: this.generation };
  }
}
