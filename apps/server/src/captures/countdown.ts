import { Inject, Injectable } from '@nestjs/common';
import { COUNTDOWN_CLIPS, DEFAULT_CONFIG, makeCue } from '@gt7/core';
import { MONO_CLOCK, type MonoClock } from '../clock/mono-clock.js';
import { LiveHub } from '../live/live-hub.service.js';

export const COUNTDOWN_SCHEDULER = Symbol('COUNTDOWN_SCHEDULER');

export type CountdownScheduler = { after(ms: number, run: () => void): () => void };

export const timerScheduler: CountdownScheduler = {
  after(ms, run) {
    const timer = setTimeout(run, ms);
    return () => clearTimeout(timer);
  }
};

export type CountdownStep = { count: number; clip: string; atMs: number };

export function countdownSteps(startAfterS: number): CountdownStep[] {
  const counts = [3, 2, 1, 0];
  return counts
    .map((count, index) => ({ count, clip: COUNTDOWN_CLIPS[index]!, atMs: Math.round((startAfterS - count) * 1000) }))
    .filter(step => step.atMs >= 0);
}

export type CountdownRequest = { userId: string; captureId: string; startAfterS: number };

@Injectable()
export class CountdownService {
  private readonly pending = new Map<string, (() => void)[]>();

  constructor(
    @Inject(COUNTDOWN_SCHEDULER) private readonly scheduler: CountdownScheduler,
    @Inject(MONO_CLOCK) private readonly clock: MonoClock,
    private readonly hub: LiveHub
  ) {}

  start(request: CountdownRequest): void {
    this.cancel(request.captureId);
    const generation = this.hub.nextGeneration();
    const cancels = countdownSteps(request.startAfterS).map(step =>
      this.scheduler.after(step.atMs, () => this.speak(request, step, generation))
    );
    this.pending.set(request.captureId, cancels);
  }

  cancel(captureId: string): void {
    for (const cancel of this.pending.get(captureId) ?? []) cancel();
    this.pending.delete(captureId);
  }

  private speak(request: CountdownRequest, step: CountdownStep, generation: number): void {
    const key = `countdown-${request.captureId}-${step.count}`;
    const cue = makeCue(
      { kind: 'countdown', generation, eventKey: key, clip: step.clip, followClip: null, targetSpeedKph: null, decidedMonoMs: this.clock.now(), deviceDelayMs: 0 },
      DEFAULT_CONFIG
    );
    this.hub.sendCue(request.userId, cue);
  }
}
