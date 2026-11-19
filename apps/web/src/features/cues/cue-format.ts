import { KPH_PER_MPS, type CornerReview, type Difference, type RecurringDifference } from '@gt7/contracts';
import { counted } from '../../app/plural.ts';

export const ON_THE_LINE_M = 0.5;

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
  return counted(count, 'attempt');
}

export function apexPlaceText(outside: number | null): string {
  if (outside === null) return 'no match at the apex';
  if (Math.abs(outside) <= ON_THE_LINE_M) return 'on the line';
  return `${Math.abs(outside).toFixed(1)} m ${outside > 0 ? 'outside' : 'inside'}`;
}

export function apexSpeedText(corner: Pick<CornerReview, 'speedMps' | 'apexSpeedMps'>): string {
  if (corner.speedMps === null) return 'no speed match at the apex';
  return `${Math.round(corner.speedMps * KPH_PER_MPS)} km/h at the apex, reference ${Math.round(corner.apexSpeedMps * KPH_PER_MPS)} km/h`;
}

const DIFFERENCE_NAMES: Record<Difference['kind'], string> = {
  'brake-early': 'Braked early',
  'brake-late': 'Braked late',
  'slow-corner': 'Slower in the corner',
  'throttle-late': 'Throttle late',
  'off-line': 'Off the reference line',
  'wide-apex': 'Wide at the apex'
};

export function sizeText(value: number, unit: Difference['unit']): string {
  return unit === 'm/s' ? `${Math.round(value * KPH_PER_MPS)} km/h` : `${Math.round(value)} m`;
}

export function differenceName(kind: Difference['kind']): string {
  return DIFFERENCE_NAMES[kind];
}

export function differenceText(difference: Difference): string {
  const amount = sizeText(difference.size, difference.unit);
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
  return `${differenceName(recurring.kind)} in ${recurring.count} of ${recurring.of} attempts, median ${sizeText(recurring.medianSize, recurring.unit)}`;
}

export function recurringAtText(recurring: RecurringDifference): string {
  return `${differenceName(recurring.kind)} at ${Math.round(recurring.sM)} m in ${recurring.count} of ${recurring.of} attempts, median ${sizeText(recurring.medianSize, recurring.unit)}`;
}
