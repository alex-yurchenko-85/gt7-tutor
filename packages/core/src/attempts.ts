import type { Sample } from '@gt7/contracts';
import type { CoreConfig } from './config.ts';
import { distance, gateOffset, lerp, type Gate } from './geometry.ts';

export type StartKind = 'standing' | 'flying';

export type BoundaryConfig = { start: Gate; end: Gate; startKind: StartKind };

export type AttemptEventType = 'started' | 'paused' | 'resumed' | 'finished' | 'aborted';

export type AttemptEvent = {
  type: AttemptEventType;
  rawIndex: number | null;
  atMonoMs: number;
  reason: string | null;
  generation: number;
};

export type AttemptState = 'waiting' | 'driving' | 'paused' | 'finished';

export type ManualAction = 'start' | 'finish' | 'abort';

type Crossing = { atMonoMs: number };

export type PositionBreak = 'car-changed' | 'discontinuity';

type Break = 'silence' | PositionBreak;

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

export function gateCrossing(gate: Gate, previous: Sample, current: Sample, config: CoreConfig): Crossing | null {
  const before = gateOffset(gate, previous.position).along;
  const after = gateOffset(gate, current.position).along;
  if (!(before < 0 && after >= 0)) return null;
  const u = before / (before - after);
  const at = gateOffset(gate, lerp(previous.position, current.position, u));
  if (at.lateral > config.gate.halfWidthM || at.height > config.gate.heightToleranceM) return null;
  const elapsedMs = current.receivedMonoMs - previous.receivedMonoMs;
  if (elapsedMs > config.gate.maxInterpolationMs) return { atMonoMs: current.receivedMonoMs };
  return { atMonoMs: previous.receivedMonoMs + u * elapsedMs };
}

export class AttemptTracker {
  private readonly boundary: BoundaryConfig;
  private readonly config: CoreConfig;
  private current: AttemptState = 'waiting';
  private generation = 0;
  private last: Sample | null = null;
  private lastRawIndex: number | null = null;
  private lastEvidenceMonoMs: number | null = null;
  private stoppedInStartArea = false;
  private movingFromStart: Sample[] = [];

  constructor(boundary: BoundaryConfig, config: CoreConfig) {
    this.boundary = boundary;
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
    if (silence) return [silence];
    const broken = previous ? continuityBreak(previous, sample, this.config) : null;
    if (this.isActive()) return this.stepActive(previous, sample, broken);
    return this.detectStart(previous, sample, broken);
  }

  tick(nowMonoMs: number): AttemptEvent[] {
    const silence = this.silenceBefore(nowMonoMs);
    return silence ? [silence] : [];
  }

  manual(action: ManualAction, nowMonoMs: number): AttemptEvent[] {
    if (action === 'start') return this.isActive() ? [] : [this.manualStart(nowMonoMs)];
    if (!this.isActive()) return [];
    if (action === 'abort') return [this.abort('manual', this.lastRawIndex, nowMonoMs)];
    this.current = 'finished';
    return [this.event('finished', this.lastRawIndex, nowMonoMs, 'manual')];
  }

  reset(): void {
    this.current = 'waiting';
    this.last = null;
    this.lastRawIndex = null;
    this.lastEvidenceMonoMs = null;
    this.clearStandingStart();
  }

  private silenceBefore(nowMonoMs: number): AttemptEvent | null {
    const evidenceMs = this.lastEvidenceMonoMs;
    if (!this.isActive() || evidenceMs === null || nowMonoMs - evidenceMs <= this.config.silenceGapMs) return null;
    return this.abort('silence', this.lastRawIndex, evidenceMs + this.config.silenceGapMs);
  }

  private manualStart(nowMonoMs: number): AttemptEvent {
    const recent = this.lastEvidenceMonoMs !== null && nowMonoMs - this.lastEvidenceMonoMs <= this.config.silenceGapMs;
    if (!recent) this.lastRawIndex = null;
    this.last = null;
    this.lastEvidenceMonoMs = nowMonoMs;
    return this.start(this.lastRawIndex, nowMonoMs, 'manual');
  }

  private isActive(): boolean {
    return this.current === 'driving' || this.current === 'paused';
  }

  private stepActive(previous: Sample | null, sample: Sample, broken: Break | null): AttemptEvent[] {
    if (!sample.playerSession) return [this.abort('player-session-ended', sample.rawIndex, sample.receivedMonoMs)];
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
    const crossing = previous ? gateCrossing(this.boundary.end, previous, sample, this.config) : null;
    if (!crossing) return [];
    this.current = 'finished';
    return [this.event('finished', sample.rawIndex, crossing.atMonoMs, 'end-gate')];
  }

  private detectStart(previous: Sample | null, sample: Sample, broken: Break | null): AttemptEvent[] {
    if (broken || !previous || !hasPlayerControl(sample) || !hasPlayerControl(previous)) {
      this.clearStandingStart();
      if (hasPlayerControl(sample)) this.observeStanding(sample);
      return [];
    }
    if (this.boundary.startKind === 'standing') return this.observeStanding(sample);
    const crossing = gateCrossing(this.boundary.start, previous, sample, this.config);
    return crossing ? [this.start(sample.rawIndex, crossing.atMonoMs, 'start-gate')] : [];
  }

  private observeStanding(sample: Sample): AttemptEvent[] {
    if (this.boundary.startKind !== 'standing') return [];
    const inArea = this.inStartArea(sample);
    if (sample.speedMps < this.config.startArea.movingSpeedMps) {
      this.movingFromStart = [];
      this.stoppedInStartArea = inArea;
      return [];
    }
    if (this.movingFromStart.length === 0 && !(this.stoppedInStartArea && inArea)) {
      this.stoppedInStartArea = false;
      return [];
    }
    this.movingFromStart.push(sample);
    if (this.movingFromStart.length < this.config.startArea.movingSamples) return [];
    const first = this.movingFromStart[0]!;
    this.clearStandingStart();
    return [this.start(first.rawIndex, first.receivedMonoMs, 'start-area')];
  }

  private inStartArea(sample: Sample): boolean {
    const offset = gateOffset(this.boundary.start, sample.position);
    return (
      Math.hypot(offset.along, offset.lateral) <= this.config.startArea.radiusM &&
      offset.height <= this.config.gate.heightToleranceM
    );
  }

  private clearStandingStart(): void {
    this.stoppedInStartArea = false;
    this.movingFromStart = [];
  }

  private start(rawIndex: number | null, atMonoMs: number, reason: string): AttemptEvent {
    this.clearStandingStart();
    this.generation += 1;
    this.current = 'driving';
    return this.event('started', rawIndex, atMonoMs, reason);
  }

  private abort(reason: string, rawIndex: number | null, atMonoMs: number): AttemptEvent {
    this.current = 'waiting';
    this.clearStandingStart();
    return this.event('aborted', rawIndex, atMonoMs, reason);
  }

  private event(type: AttemptEventType, rawIndex: number | null, atMonoMs: number, reason: string | null): AttemptEvent {
    return { type, rawIndex, atMonoMs, reason, generation: this.generation };
  }
}
