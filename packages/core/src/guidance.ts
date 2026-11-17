export type GuidanceMode = 'active' | 'suspended' | 'waiting-for-restart';

export type GuidanceReason = 'untrusted-position' | 'target-incompatible' | 'model-uncertain' | 'awaiting-restart' | null;

export type GuidanceState = { mode: GuidanceMode; reason: GuidanceReason };

export type GuidanceTransition = 'paused' | 'resumed' | null;

const ACTIVE: GuidanceState = { mode: 'active', reason: null };

export class Guidance {
  private current: GuidanceState = ACTIVE;
  private resumableSinceMs: number | null = null;

  get state(): GuidanceState {
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
    this.current = ACTIVE;
    this.resumableSinceMs = null;
    return 'resumed';
  }

  awaitRestart(): void {
    this.current = { mode: 'waiting-for-restart', reason: 'awaiting-restart' };
    this.resumableSinceMs = null;
  }

  reset(): void {
    this.current = ACTIVE;
    this.resumableSinceMs = null;
  }
}
