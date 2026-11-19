import type { AttemptList, AttemptReview, AttemptSummary } from '@gt7/contracts';

type AttemptOverrides = Partial<Omit<AttemptSummary, 'completion' | 'timeMs'>> & { completion?: AttemptSummary['completion']; timeMs?: number | null };

export function attemptSummary(overrides: AttemptOverrides = {}): AttemptSummary {
  return {
    id: 'a0000000-0000-4000-8000-000000000001',
    exerciseId: 'e0000000-0000-4000-8000-000000000001',
    number: 1,
    referenceId: 'ref-demo',
    captureId: 'cap-9',
    first: 1162,
    last: 2786,
    mode: 'baseline',
    completion: 'complete',
    reason: null,
    timeMs: 27100,
    gapToBestMs: 0,
    largestDifference: null,
    focus: null,
    startedAt: '2026-11-16T11:23:30.000Z',
    ...overrides
  } as AttemptSummary;
}

export const ATTEMPT_LIST: AttemptList = {
  bestMs: 26800,
  days: [
    {
      date: '2026-11-17',
      bestMs: 26800,
      attempts: [
        attemptSummary({ id: 'a0000000-0000-4000-8000-000000000003', number: 3, timeMs: null, completion: 'aborted', reason: 'manual', gapToBestMs: null }),
        attemptSummary({ id: 'a0000000-0000-4000-8000-000000000002', number: 2, timeMs: 26800, gapToBestMs: 0, mode: 'guided' })
      ]
    },
    {
      date: '2026-11-16',
      bestMs: 27100,
      attempts: [
        attemptSummary({
          id: 'a0000000-0000-4000-8000-000000000001',
          number: 1,
          gapToBestMs: 300,
          largestDifference: { kind: 'brake-early', eventKey: 'brake@332', sM: 332, size: 14, unit: 'm', turn: 1 }
        })
      ]
    }
  ]
};

const LENGTH = 20;
const POINTS = LENGTH / 2 + 1;

function series(values: (number | null)[]) {
  return values;
}

export function review(overrides: Partial<AttemptReview> = {}): AttemptReview {
  const index = Array.from({ length: POINTS }, (_, i) => i);
  return {
    referenceId: 'ref-demo',
    gridM: 2,
    lengthM: LENGTH,
    referenceTimeMs: 25470,
    reference: {
      t: series(index.map(i => i * 100)),
      v: series(index.map(i => 30 + i)),
      th: series(index.map(i => (i < 5 ? 1 : 0))),
      br: series(index.map(i => (i >= 5 && i < 7 ? 0.8 : 0))),
      x: series(index.map(i => i * 2)),
      z: series(index.map(() => 0)),
      lat: series(index.map(() => 0))
    },
    attempt: {
      t: series(index.map(i => i * 110)),
      v: series(index.map(i => 29 + i)),
      th: series(index.map(i => (i < 4 ? 1 : 0))),
      br: series(index.map(i => (i >= 4 && i < 7 ? 0.7 : 0))),
      x: series(index.map(i => i * 2)),
      z: series(index.map(() => 1)),
      lat: series(index.map(() => 1))
    },
    referenceEvents: [{ key: 'brake@10', kind: 'brake', sM: 10, endSM: 14, targetSpeedKph: 85 }],
    attemptEvents: [{ key: 'brake@8', kind: 'brake', sM: 8, endSM: 14, targetSpeedKph: 80 }],
    findings: [
      { kind: 'brake-early', eventKey: 'brake@10', sM: 10, size: 2, unit: 'm', turn: null },
      { kind: 'off-line', eventKey: null, sM: 16, size: 1.6, unit: 'm', turn: null }
    ],
    turnLosses: [],
    cues: [],
    corners: [],
    reactions: [],
    ...overrides
  };
}

export function withGap(base: AttemptReview): AttemptReview {
  const blank = (values: (number | null)[]) => values.map((value, i) => (i === 4 || i === 5 ? null : value));
  return {
    ...base,
    attempt: {
      t: blank(base.attempt.t),
      v: blank(base.attempt.v),
      th: blank(base.attempt.th),
      br: blank(base.attempt.br),
      x: blank(base.attempt.x),
      z: blank(base.attempt.z),
      lat: blank(base.attempt.lat)
    }
  };
}
