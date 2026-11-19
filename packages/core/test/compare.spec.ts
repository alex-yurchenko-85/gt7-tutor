import { describe, expect, it } from 'vitest';
import { buildReview } from '../src/compare.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { between, samplesOf } from './fixtures.ts';
import { analysisOf, interlagosAnalysis } from './paths.ts';
import { flatPath, simulate } from './coaching.ts';

describe('buildReview', () => {
  const cleanRun = samplesOf('ce-clean');

  it('clean_run_review_has_410_grid_points', () => {
    const review = buildReview(between(cleanRun, 8451, 9479), interlagosAnalysis(), DEFAULT_CONFIG);
    expect(review.gridM).toBe(2);
    expect(review.lengthM).toBeCloseTo(818.17, 1);
    for (const series of [review.reference, review.attempt]) {
      for (const channel of Object.values(series)) expect(channel).toHaveLength(410);
    }
    expect(review.attempt.lat.every(value => value !== null)).toBe(true);
    expect(review.attempt.v.every(value => value !== null)).toBe(true);
    expect(review.reference.lat.every(value => value === 0)).toBe(true);
    expect(review.reference.t[0]).toBe(0);
    expect(review.attempt.t[0]).toBe(0);
    expect(Math.abs(review.attempt.t.at(-1)! - 17071)).toBeLessThan(40);
    expect(Math.abs(review.reference.t.at(-1)! - 16082)).toBeLessThan(40);
    expect(review.referenceEvents[0]!.key).toBe('brake@291');
    const firstAttemptBrake = review.attemptEvents.find(event => event.kind === 'brake')!;
    expect(Math.abs(firstAttemptBrake.sM - 274)).toBeLessThanOrEqual(3);
  });

  it('unmatched_gap_gives_null_not_zero', () => {
    const path = flatPath(400, () => 100);
    const samples = simulate(399, sM => ({ speedKph: 100, lateralM: sM >= 150 && sM < 200 ? 12 : 0 }));
    const review = buildReview(samples, analysisOf(path), DEFAULT_CONFIG);
    const at = (sM: number) => sM / review.gridM;
    expect(review.attempt.lat[at(200)]).toBeNull();
    expect(review.attempt.v[at(200)]).toBeNull();
    expect(review.attempt.t[at(200)]).toBeNull();
    expect(review.attempt.lat[at(100)]).toBeCloseTo(0, 6);
    expect(review.attempt.lat[at(300)]).toBeCloseTo(0, 6);
    expect(review.attempt.v[at(300)]).toBeCloseTo(100 / 3.6, 6);
  });

  it('paused_time_is_excluded', () => {
    const path = flatPath(400, () => 100);
    const samples = simulate(399, (sM, index) => ({ speedKph: 100, paused: index >= 200 && index < 740 }));
    const review = buildReview(samples, analysisOf(path), DEFAULT_CONFIG);
    expect(review.attempt.t.at(-2)! / 1000).toBeCloseTo((398 - 0.5) / (100 / 3.6), 1);
  });
});
