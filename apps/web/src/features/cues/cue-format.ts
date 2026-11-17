import type { CornerReview, Difference, RecurringDifference, ReferenceCue } from '@gt7/contracts';

export const OFFSET_STEP_MS = 100;
export const OFFSET_MIN_MS = -500;
export const OFFSET_MAX_MS = 1000;
export const ON_THE_LINE_M = 0.5;

export function clipOf(cue: Pick<ReferenceCue, 'voice'>): string {
  return cue.voice;
}

export function followClipOf(cue: Pick<ReferenceCue, 'kind' | 'targetSpeedKph'>, speakTargets: boolean): string | null {
  return speakTargets && cue.kind === 'brake' && cue.targetSpeedKph !== null ? `speed-${cue.targetSpeedKph}` : null;
}

function seconds(ms: number): string {
  return (Math.abs(ms) / 1000).toFixed(1);
}

export function offsetText(ms: number): string {
  if (ms === 0) return 'On time';
  return `${seconds(ms)} s ${ms > 0 ? 'earlier' : 'later'}`;
}

export function reactionText(reactionMs: number): string {
  return `${seconds(reactionMs)} s ${reactionMs < 0 ? 'before' : 'after'} the cue`;
}

export function attemptsText(count: number): string {
  return `${count} guided attempt${count === 1 ? '' : 's'}`;
}

export function apexPlaceText(outside: number | null): string {
  if (outside === null) return 'no match at the apex';
  if (Math.abs(outside) <= ON_THE_LINE_M) return 'on the line';
  return `${Math.abs(outside).toFixed(1)} m ${outside > 0 ? 'outside' : 'inside'}`;
}

export function apexSpeedText(corner: Pick<CornerReview, 'speedKph' | 'apexSpeedKph'>): string {
  if (corner.speedKph === null) return 'no speed match at the apex';
  return `${Math.round(corner.speedKph)} km/h at the apex, reference ${Math.round(corner.apexSpeedKph)} km/h`;
}

const DIFFERENCE_NAMES: Record<Difference['kind'], string> = {
  'brake-early': 'Braked early',
  'brake-late': 'Braked late',
  'slow-corner': 'Slower in the corner',
  'throttle-late': 'Throttle late',
  'off-line': 'Off the reference line',
  'wide-apex': 'Wide at the apex'
};

function size(value: number, unit: Difference['unit']): string {
  return `${Math.round(value)} ${unit}`;
}

export function differenceName(kind: Difference['kind']): string {
  return DIFFERENCE_NAMES[kind];
}

export function differenceText(difference: Difference): string {
  const amount = size(difference.size, difference.unit);
  switch (difference.kind) {
    case 'brake-early':
      return `Braked ${amount} earlier`;
    case 'brake-late':
      return `Braked ${amount} later`;
    case 'slow-corner':
      return `${amount} slower in the corner`;
    case 'throttle-late':
      return `Throttle ${amount} later`;
    case 'off-line':
      return `Up to ${amount} from the reference line`;
    case 'wide-apex':
      return `${difference.size.toFixed(1)} m outside at the apex`;
  }
}

export function recurringText(recurring: RecurringDifference): string {
  return `${differenceName(recurring.kind)} in ${recurring.count} of ${recurring.of} attempts, median ${size(recurring.medianSize, recurring.unit)}`;
}

export function recurringAtText(recurring: RecurringDifference): string {
  return `${differenceName(recurring.kind)} at ${Math.round(recurring.sM)} m in ${recurring.count} of ${recurring.of} attempts, median ${size(recurring.medianSize, recurring.unit)}`;
}
