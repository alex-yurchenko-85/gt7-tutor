import { describe, expect, it } from 'vitest';
import { SpeedWindow } from '../src/speed-window.ts';

type Mark = { atMs: number; speedMps: number };

function filtered(marks: Mark[], atMs: number, speedMps: number, windowMs: number): Mark[] {
  const kept = marks.filter(mark => atMs - mark.atMs <= windowMs);
  kept.push({ atMs, speedMps });
  return kept;
}

function compare(times: number[], windowMs: number): void {
  const speeds = new SpeedWindow(windowMs);
  let marks: Mark[] = [];
  times.forEach((atMs, index) => {
    const speedMps = 10 + index;
    marks = filtered(marks, atMs, speedMps, windowMs);
    speeds.add(atMs, speedMps);
    expect({ atMs: speeds.oldestAtMs, speedMps: speeds.oldestSpeedMps }, `mark ${index}`).toEqual(marks[0]);
  });
}

describe('SpeedWindow', () => {
  it('speed_window_keeps_the_marks_of_the_window', () => {
    compare(Array.from({ length: 200 }, (_, index) => index * (1000 / 60)), 300);
  });

  it('speed_window_keeps_marks_that_arrive_at_the_same_time', () => {
    compare([...Array.from({ length: 80 }, () => 0), 100, 100, 350, 350, 700, ...Array.from({ length: 80 }, () => 800), 1200], 300);
  });

  it('speed_window_after_a_clock_step_back_keeps_the_same_marks_as_a_filter', () => {
    compare([0, 100, 200, 500, 100, 150, 450, 460, 900, 120, 130, 1500, 1600, 1700, 1800, 1900, 2000], 300);
  });

  it('speed_window_starts_empty_after_clear', () => {
    const speeds = new SpeedWindow(300);
    speeds.add(0, 10);
    speeds.add(100, 20);
    speeds.clear();
    speeds.add(150, 30);
    expect([speeds.oldestAtMs, speeds.oldestSpeedMps]).toEqual([150, 30]);
  });
});
