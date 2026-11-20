import { KPH_PER_MPS, type FindingKindName } from '@gt7/contracts';
import type { Review } from './compare.ts';
import type { CoreConfig } from './config.ts';
import { outsideM, type Corner } from './corners.ts';
import { brakeWindowEndM, type ReferenceCueEvent } from './cue-events.ts';
import { median } from './statistics.ts';

export type Finding = { kind: FindingKindName; eventKey: string | null; sM: number; size: number; unit: 'm' | 'm/s' };

export type Recurring = Finding & { count: number; of: number; medianSize: number };

const EPSILON = 1e-9;

export function comparableSize(size: number, unit: Finding['unit']): number {
  return unit === 'm/s' ? size * KPH_PER_MPS : size;
}

function exceeds(value: number, limit: number): boolean {
  return value > limit + EPSILON;
}

function nearest(events: ReferenceCueEvent[], target: ReferenceCueEvent, windowM: number): ReferenceCueEvent | null {
  let best: ReferenceCueEvent | null = null;
  for (const event of events) {
    if (event.kind !== target.kind || Math.abs(event.sM - target.sM) > windowM) continue;
    if (!best || Math.abs(event.sM - target.sM) < Math.abs(best.sM - target.sM)) best = event;
  }
  return best;
}

function brakeFindings(review: Review, config: CoreConfig): Finding[] {
  return review.referenceEvents.flatMap(reference => {
    if (reference.kind !== 'brake') return [];
    const attempt = nearest(review.attemptEvents, reference, config.findings.eventWindowM);
    if (!attempt) return [];
    const differenceM = attempt.sM - reference.sM;
    if (!exceeds(Math.abs(differenceM), config.findings.brakeM)) return [];
    const kind: FindingKindName = differenceM < 0 ? 'brake-early' : 'brake-late';
    return [{ kind, eventKey: reference.key, sM: reference.sM, size: Math.abs(differenceM), unit: 'm' as const }];
  });
}

function throttleFindings(review: Review, config: CoreConfig): Finding[] {
  return review.referenceEvents.flatMap(reference => {
    if (reference.kind !== 'throttle') return [];
    const attempt = nearest(review.attemptEvents, reference, config.findings.eventWindowM);
    if (!attempt) return [];
    const lateM = attempt.sM - reference.sM;
    if (!exceeds(lateM, config.findings.throttleLateM)) return [];
    return [{ kind: 'throttle-late' as const, eventKey: reference.key, sM: reference.sM, size: lateM, unit: 'm' as const }];
  });
}

function minimumIn(values: (number | null)[], fromCell: number, toCell: number): { cell: number; value: number } | null {
  let best: { cell: number; value: number } | null = null;
  for (let cell = Math.max(0, fromCell); cell <= Math.min(values.length - 1, toCell); cell++) {
    const value = values[cell];
    if (value === null || value === undefined) continue;
    if (!best || value < best.value) best = { cell, value };
  }
  return best;
}

function slowCornerFindings(review: Review, config: CoreConfig): Finding[] {
  const brakes = review.referenceEvents.filter(event => event.kind === 'brake');
  return brakes.flatMap((brake, index) => {
    const nextBrakeM = brakes[index + 1]?.sM ?? Number.POSITIVE_INFINITY;
    const untilM = brakeWindowEndM(brake.endSM ?? brake.sM, nextBrakeM - review.gridM, config);
    const fromCell = Math.ceil(brake.sM / review.gridM);
    const toCell = Math.floor(untilM / review.gridM);
    const reference = minimumIn(review.reference.v, fromCell, toCell);
    const attempt = minimumIn(review.attempt.v, fromCell, toCell);
    if (!reference || !attempt) return [];
    const slowerMps = reference.value - attempt.value;
    if (!exceeds(slowerMps, config.findings.slowCornerMps)) return [];
    return [{ kind: 'slow-corner' as const, eventKey: brake.key, sM: reference.cell * review.gridM, size: slowerMps, unit: 'm/s' as const }];
  });
}

function offLineFindings(review: Review, config: CoreConfig): Finding[] {
  const findings: Finding[] = [];
  const { lat, t } = review.attempt;
  let start: number | null = null;
  const close = (end: number) => {
    if (start === null) return;
    const durationMs = t[end]! - t[start]!;
    if (exceeds(durationMs, config.findings.offLineMs)) {
      let peak = start;
      for (let cell = start; cell <= end; cell++) if (Math.abs(lat[cell]!) > Math.abs(lat[peak]!)) peak = cell;
      findings.push({ kind: 'off-line', eventKey: null, sM: peak * review.gridM, size: Math.abs(lat[peak]!), unit: 'm' });
    }
    start = null;
  };
  lat.forEach((value, cell) => {
    const outside = value !== null && t[cell] !== null && exceeds(Math.abs(value), config.findings.offLineM);
    const sameSide = start !== null && Math.sign(value ?? 0) === Math.sign(lat[start]!);
    if (outside && (start === null || sameSide)) {
      start ??= cell;
      return;
    }
    close(cell - 1);
    if (outside) start = cell;
  });
  close(lat.length - 1);
  return findings;
}

export function cornerKey(corner: Corner): string {
  return `corner-${corner.number}`;
}

export function seriesAt(values: (number | null)[], gridM: number, sM: number): number | null {
  const position = sM / gridM;
  const before = values[Math.floor(position)];
  const after = values[Math.ceil(position)];
  if (before === null || before === undefined || after === null || after === undefined) return null;
  return before + (after - before) * (position - Math.floor(position));
}

function wideApexFindings(review: Review, config: CoreConfig): Finding[] {
  return review.corners.flatMap(corner => {
    const lateralM = seriesAt(review.attempt.lat, review.gridM, corner.apexSM);
    if (lateralM === null) return [];
    const outside = outsideM(corner, lateralM);
    if (!exceeds(outside, config.corners.wideApexM)) return [];
    return [{ kind: 'wide-apex' as const, eventKey: cornerKey(corner), sM: corner.apexSM, size: outside, unit: 'm' as const }];
  });
}

export function findDifferences(review: Review, config: CoreConfig): Finding[] {
  return [
    ...brakeFindings(review, config),
    ...slowCornerFindings(review, config),
    ...throttleFindings(review, config),
    ...offLineFindings(review, config),
    ...wideApexFindings(review, config)
  ].sort((a, b) => a.sM - b.sM);
}

type Group = { kind: FindingKindName; eventKey: string | null; unit: Finding['unit']; sMs: number[]; sizes: number[]; attempts: Set<number> };

function belongs(group: Group, finding: Finding, placeWithinM: number): boolean {
  if (group.kind !== finding.kind || group.eventKey !== finding.eventKey) return false;
  return finding.eventKey !== null || Math.abs(median(group.sMs) - finding.sM) <= placeWithinM;
}

export function recurring(perAttempt: Finding[][], config: CoreConfig): Recurring[] {
  const of = perAttempt.length;
  if (of < config.recurring.minAttempts) return [];
  const groups: Group[] = [];
  perAttempt.forEach((findings, attempt) => {
    for (const finding of findings) {
      let group = groups.find(candidate => belongs(candidate, finding, config.recurring.placeWithinM));
      if (!group) {
        group = { kind: finding.kind, eventKey: finding.eventKey, unit: finding.unit, sMs: [], sizes: [], attempts: new Set() };
        groups.push(group);
      }
      if (group.attempts.has(attempt)) continue;
      group.attempts.add(attempt);
      group.sMs.push(finding.sM);
      group.sizes.push(finding.size);
    }
  });
  return groups
    .filter(group => group.attempts.size >= config.recurring.minShare * of)
    .map(group => {
      const medianSize = median(group.sizes);
      return {
        kind: group.kind,
        eventKey: group.eventKey,
        sM: group.eventKey === null ? median(group.sMs) : group.sMs[0]!,
        size: medianSize,
        unit: group.unit,
        count: group.attempts.size,
        of,
        medianSize
      };
    })
    .sort((a, b) => b.count - a.count || a.sM - b.sM);
}
