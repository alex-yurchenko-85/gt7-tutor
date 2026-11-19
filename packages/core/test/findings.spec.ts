import { describe, expect, it } from 'vitest';
import { buildReview, type Review, type Series } from '../src/compare.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { findDifferences, recurring, type Finding } from '../src/findings.ts';
import { between, samplesOf } from './fixtures.ts';
import { interlagosAnalysis } from './paths.ts';
import { event } from './coaching.ts';
import type { Corner } from '../src/corners.ts';
import { kph } from '../src/units.ts';
import { KPH_PER_MPS } from '@gt7/contracts';

function syntheticCorner(number: number, apexSM: number, insideSign: 1 | -1 = 1): Corner {
  return { number, zoneStartSM: apexSM - 60, turnInSM: apexSM - 30, apexSM, radiusM: 50, apexSpeedMps: kph(100), insideSign };
}

const GRID = 2;
const POINTS = 201;

function series(fill: (index: number) => Partial<Record<keyof Series, number | null>>): Series {
  const out: Series = { t: [], v: [], th: [], br: [], x: [], z: [], lat: [] };
  for (let index = 0; index < POINTS; index++) {
    const values = { t: index * 100, v: 30, th: 1, br: 0, x: index * GRID, z: 0, lat: 0, ...fill(index) };
    out.t.push(values.t as number);
    out.v.push(values.v as number);
    out.th.push(values.th as number);
    out.br.push(values.br as number);
    out.x.push(values.x as number);
    out.z.push(values.z as number);
    out.lat.push(values.lat);
  }
  return out;
}

function review(o: Partial<Review>): Review {
  return {
    gridM: 2,
    lengthM: (POINTS - 1) * GRID,
    reference: series(() => ({})),
    attempt: series(() => ({})),
    referenceEvents: [],
    attemptEvents: [],
    corners: [],
    ...o
  };
}

function finding(kind: Finding['kind'], eventKey: string | null, size: number, sM = 100): Finding {
  return { kind, eventKey, sM, size, unit: kind === 'slow-corner' ? 'm/s' : 'm' };
}

describe('findDifferences', () => {
  it('pause_run_first_brake_is_early', () => {
    const findings = findDifferences(buildReview(between(samplesOf('ce-pause'), 11564, 13309), interlagosAnalysis(), DEFAULT_CONFIG), DEFAULT_CONFIG);
    const early = findings.find(entry => entry.kind === 'brake-early' && entry.eventKey === 'brake@291')!;
    expect(early).toBeDefined();
    expect(early.size).toBeGreaterThanOrEqual(30);
    expect(early.size).toBeLessThanOrEqual(40);
    expect(early.unit).toBe('m');
    expect(early.sM).toBe(291);
    expect(findings.some(entry => entry.kind === 'off-line' && entry.sM >= 340 && entry.sM <= 440)).toBe(true);
  });

  it('slow_run_first_brake_is_late', () => {
    const findings = findDifferences(buildReview(between(samplesOf('ce-slow'), 5491, 6624), interlagosAnalysis(), DEFAULT_CONFIG), DEFAULT_CONFIG);
    const late = findings.find(entry => entry.kind === 'brake-late' && entry.eventKey === 'brake@291')!;
    expect(late.size).toBeGreaterThanOrEqual(30);
    expect(late.size).toBeLessThanOrEqual(45);
    expect(findings.some(entry => entry.kind === 'slow-corner' && entry.eventKey === 'brake@291')).toBe(true);
  });

  it('finding_limits', () => {
    const brake = [event('brake', 200, 100, 240)];
    const at = (attemptSM: number) =>
      findDifferences(review({ referenceEvents: brake, attemptEvents: [event('brake', attemptSM, 100, 240)] }), DEFAULT_CONFIG);
    expect(at(192)).toEqual([]);
    expect(at(208)).toEqual([]);
    expect(at(191)).toEqual([finding('brake-early', 'brake@200', 9, 200)]);
    expect(at(209)).toEqual([finding('brake-late', 'brake@200', 9, 200)]);

    const offLine = (fromIndex: number, durationMs: number) =>
      findDifferences(
        review({
          attempt: series(index => {
            const t = index * 100;
            const inside = index >= fromIndex && t <= fromIndex * 100 + durationMs;
            return { t, lat: inside ? (index === fromIndex + 2 ? 1.9 : 1.6) : 0 };
          })
        }),
        DEFAULT_CONFIG
      );
    expect(offLine(50, 400)).toEqual([]);
    expect(offLine(50, 500)).toEqual([]);
    expect(offLine(50, 600)).toEqual([finding('off-line', null, 1.9, 104)]);

    const exact = (lastMs: number) =>
      findDifferences(
        review({ attempt: series(index => ({ t: index === 51 ? 1000 + lastMs : index * 20, lat: index === 50 || index === 51 ? 2 : 0 })) }),
        DEFAULT_CONFIG
      );
    expect(exact(499).filter(entry => entry.kind === 'off-line')).toEqual([]);
    expect(exact(501).filter(entry => entry.kind === 'off-line')).toHaveLength(1);
  });

  it('throttle_late_limit', () => {
    const throttle = [event('throttle', 300, 150)];
    const at = (attemptSM: number) =>
      findDifferences(review({ referenceEvents: throttle, attemptEvents: [event('throttle', attemptSM, 150)] }), DEFAULT_CONFIG);
    expect(at(310)).toEqual([]);
    expect(at(311)).toEqual([finding('throttle-late', 'throttle@300', 11, 300)]);
    expect(at(280)).toEqual([]);
  });

  it('slow_corner_limit', () => {
    const brake = [event('brake', 100, 80, 140)];
    const reference = series(index => ({ v: index * GRID >= 140 && index * GRID <= 150 ? 80 / 3.6 : 30 }));
    const slower = (deltaKph: number) =>
      series(index => ({ v: index * GRID >= 140 && index * GRID <= 150 ? (80 - deltaKph) / 3.6 : 30 }));
    expect(findDifferences(review({ reference, attempt: slower(8), referenceEvents: brake }), DEFAULT_CONFIG)).toEqual([]);
    const found = findDifferences(review({ reference, attempt: slower(9), referenceEvents: brake }), DEFAULT_CONFIG);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ kind: 'slow-corner', eventKey: 'brake@100', unit: 'm/s' });
    expect(found[0]!.size * KPH_PER_MPS).toBeCloseTo(9, 6);
  });

  it('missing_attempt_event_gives_no_brake_finding', () => {
    expect(findDifferences(review({ referenceEvents: [event('brake', 200, 100, 240)] }), DEFAULT_CONFIG)).toEqual([]);
  });
});

describe('recurring', () => {
  const early = (size: number) => [finding('brake-early', 'brake@332', size, 332)];

  it('recurring_needs_three_attempts_and_half', () => {
    expect(recurring([early(10), early(12)], DEFAULT_CONFIG)).toEqual([]);
    expect(recurring([early(10), [], early(20), []], DEFAULT_CONFIG)).toEqual([
      { ...finding('brake-early', 'brake@332', 15, 332), count: 2, of: 4, medianSize: 15 }
    ]);
    expect(recurring([early(10), [], [], []], DEFAULT_CONFIG)).toEqual([]);
  });

  it('kinds_and_events_count_separately', () => {
    const late = [finding('brake-late', 'brake@332', 9, 332)];
    expect(recurring([early(10), late, late, early(12), late], DEFAULT_CONFIG).map(entry => [entry.kind, entry.count, entry.of])).toEqual([
      ['brake-late', 3, 5]
    ]);
  });

  it('off_line_recurs_by_place', () => {
    const near = (sM: number) => [finding('off-line', null, 2, sM)];
    const result = recurring([near(500), near(510), near(900)], DEFAULT_CONFIG);
    expect(result.map(entry => [entry.kind, entry.count, entry.of])).toEqual([['off-line', 2, 3]]);
    expect(result[0]!.sM).toBe(505);
  });
});

describe('wide apex', () => {
  it('wide_apex_on_the_clean_run', () => {
    const findings = findDifferences(buildReview(between(samplesOf('ce-clean'), 8451, 9479), interlagosAnalysis(), DEFAULT_CONFIG), DEFAULT_CONFIG);
    const wide = findings.filter(entry => entry.kind === 'wide-apex');
    expect(wide.map(entry => entry.eventKey)).toEqual(['corner-1']);
    expect(Math.abs(wide[0]!.size - 3.0)).toBeLessThanOrEqual(0.5);
    expect(wide[0]!.unit).toBe('m');
    expect(Math.abs(wide[0]!.sM - 404)).toBeLessThanOrEqual(5);
  });

  it('slow_run_has_no_wide_apex', () => {
    const findings = findDifferences(buildReview(between(samplesOf('ce-slow'), 5491, 6624), interlagosAnalysis(), DEFAULT_CONFIG), DEFAULT_CONFIG);
    expect(findings.filter(entry => entry.kind === 'wide-apex')).toEqual([]);
  });

  it('review_lists_the_corners', () => {
    const corners = buildReview(between(samplesOf('ce-clean'), 8451, 9479), interlagosAnalysis(), DEFAULT_CONFIG).corners;
    expect(corners.map(corner => corner.number)).toEqual([1]);
  });

  it('wide_apex_limit', () => {
    const corner = syntheticCorner(1, 200, 1);
    const at = (outside: number, insideSign: 1 | -1 = 1) =>
      findDifferences(
        review({ corners: [{ ...corner, insideSign }], attempt: series(() => ({ lat: -insideSign * outside })) }),
        { ...DEFAULT_CONFIG, findings: { ...DEFAULT_CONFIG.findings, offLineM: 100 } }
      ).filter(entry => entry.kind === 'wide-apex');
    expect(at(2.0)).toEqual([]);
    expect(at(2.1)).toEqual([{ kind: 'wide-apex', eventKey: 'corner-1', sM: 200, size: expect.closeTo(2.1, 6), unit: 'm' }]);
    expect(at(2.1, -1)).toHaveLength(1);
    expect(at(-3)).toEqual([]);
  });

  it('wide_apex_recurs_by_corner', () => {
    const wide = (size: number): Finding => ({ kind: 'wide-apex', eventKey: 'corner-2', sM: 737, size, unit: 'm' });
    const result = recurring([[wide(3)], [wide(4)], [wide(2.5)], []], DEFAULT_CONFIG);
    expect(result).toEqual([expect.objectContaining({ kind: 'wide-apex', eventKey: 'corner-2', count: 3, of: 4, medianSize: 3 })]);
  });
});

