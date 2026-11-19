import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { findCorners } from '../src/corners.ts';
import { buildCueEvents } from '../src/cue-events.ts';
import { cutToTimerRun } from '../src/demo-range.ts';
import { analyseReference } from '../src/reference-analysis.ts';
import { buildReference } from '../src/reference.ts';
import { between, samplesOf } from './fixtures.ts';
import { drive, straightLine } from './synthetic.ts';

describe('analyseReference', () => {
  it('analysis_holds_the_path_events_and_corners_of_the_reference', () => {
    const samples = between(samplesOf('demo-a'), 457, 1422);
    const analysis = analyseReference(samples, 'flying', DEFAULT_CONFIG);
    const path = buildReference(samples, 'flying', DEFAULT_CONFIG);
    const events = buildCueEvents(path, DEFAULT_CONFIG);
    expect(analysis.path).toEqual(path);
    expect(analysis.events).toEqual(events);
    expect(analysis.corners).toEqual(findCorners(path, events, DEFAULT_CONFIG));
    expect(analysis.corners.length).toBeGreaterThan(0);
  });

  it('reference_time_is_the_game_time_of_the_timer_run', () => {
    const run = cutToTimerRun(samplesOf('demo-a'), { first: 300, last: 1700 }, 'demonstration')!;
    const analysis = analyseReference(between(samplesOf('demo-a'), run.first, run.last), 'flying', DEFAULT_CONFIG);
    expect(analysis.timeMs).toBe(run.gameTimeMs);
    expect(analysis.timeMs).toBe(16082);
  });

  it('reference_time_includes_a_held_end', () => {
    const moving = drive(straightLine({ fromX: 0, toX: 30, speedMps: 10 }));
    const held = Array.from({ length: 3 }, (_, index) => ({ ...moving.at(-1)!, rawIndex: moving.length + index, packetId: moving.length + index + 1 }));
    const samples = [...moving, ...held].map((sample, index) => ({ ...sample, gameTimerMs: index * 20 }));
    const analysis = analyseReference(samples, 'flying', DEFAULT_CONFIG);
    expect(analysis.path.points.at(-1)!.timerMs).toBe((moving.length - 1) * 20);
    expect(analysis.timeMs).toBe((samples.length - 1) * 20);
  });
});
