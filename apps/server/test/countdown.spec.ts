import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COUNTDOWN_PRIORITY, countdownSteps, timerScheduler } from '../src/captures/countdown.js';

describe('recording countdown', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('timer_scheduler_runs_after_the_delay', () => {
    const run = vi.fn();
    timerScheduler.after(1000, run);
    vi.advanceTimersByTime(999);
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('timer_scheduler_cancel_stops_the_run', () => {
    const run = vi.fn();
    const cancel = timerScheduler.after(1000, run);
    cancel();
    vi.advanceTimersByTime(2000);
    expect(run).not.toHaveBeenCalled();
  });

  it('countdown_steps_follow_the_wait', () => {
    expect(countdownSteps(5)).toEqual([
      { count: 3, clip: 'countdown-three', atMs: 2000 },
      { count: 2, clip: 'countdown-two', atMs: 3000 },
      { count: 1, clip: 'countdown-one', atMs: 4000 },
      { count: 0, clip: 'countdown-start', atMs: 5000 }
    ]);
    expect(countdownSteps(0)).toEqual([{ count: 0, clip: 'countdown-start', atMs: 0 }]);
    expect(countdownSteps(2.5).map(step => step.atMs)).toEqual([500, 1500, 2500]);
    expect(COUNTDOWN_PRIORITY).toBe(101);
  });
});
