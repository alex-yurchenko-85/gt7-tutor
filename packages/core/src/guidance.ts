import type { GuidanceReason, LiveGuidance } from '@gt7/contracts';

export type GuidanceTransition = 'paused' | 'resumed' | null;

export const ACTIVE_GUIDANCE: LiveGuidance = Object.freeze({ mode: 'active', reason: null });

export class Guidance {
  private current: LiveGuidance = ACTIVE_GUIDANCE;
  private resumableSinceMs: number | null = null;

  get state(): LiveGuidance {
    return this.current;
  }

  suspend(reason: Exclude<GuidanceReason, null | 'awaiting-restart'>): GuidanceTransition {
    this.resumableSinceMs = null;
    if (this.current.mode === 'waiting-for-restart') return null;
    const wasActive = this.current.mode === 'active';
    this.current = { mode: 'suspended', reason };
    return wasActive ? 'paused' : null;
  }

  observeResume(resumable: boolean, nowMonoMs: number, resumeAfterMs: number): GuidanceTransition {
    if (this.current.mode !== 'suspended') return null;
    if (!resumable) {
      this.resumableSinceMs = null;
      return null;
    }
    this.resumableSinceMs ??= nowMonoMs;
    if (nowMonoMs - this.resumableSinceMs < resumeAfterMs) return null;
    this.current = ACTIVE_GUIDANCE;
    this.resumableSinceMs = null;
    return 'resumed';
  }

  awaitRestart(): void {
    this.current = { mode: 'waiting-for-restart', reason: 'awaiting-restart' };
    this.resumableSinceMs = null;
  }

  reset(): void {
    this.current = ACTIVE_GUIDANCE;
    this.resumableSinceMs = null;
  }
}
