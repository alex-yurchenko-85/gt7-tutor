import { KPH_PER_MPS, type CornerReview, type Difference, type RecurringDifference } from '@gt7/contracts';
import { metres } from '../../app/format.ts';
import { t } from '../../app/i18n.ts';

export const ON_THE_LINE_M = 0.5;

function seconds(ms: number): string {
  return (Math.abs(ms) / 1000).toFixed(1);
}

export function offsetText(ms: number): string {
  if (ms === 0) return t('exercises.cues.on-time');
  return t(ms > 0 ? 'exercises.cues.earlier' : 'exercises.cues.later', { seconds: seconds(ms) });
}

export function reactionText(reactionMs: number): string {
  return t(reactionMs < 0 ? 'exercises.cues.reaction-before' : 'exercises.cues.reaction-after', { seconds: seconds(reactionMs) });
}

export function attemptsText(count: number): string {
  return t('common.count.attempt', { count });
}

export function apexPlaceText(outside: number | null): string {
  if (outside === null) return t('exercises.apex.no-match');
  if (Math.abs(outside) <= ON_THE_LINE_M) return t('exercises.apex.on-line');
  return t(outside > 0 ? 'exercises.apex.outside' : 'exercises.apex.inside', { metres: Math.abs(outside).toFixed(1) });
}

export function apexSpeedText(corner: Pick<CornerReview, 'speedMps' | 'apexSpeedMps'>): string {
  if (corner.speedMps === null) return t('exercises.apex.no-speed');
  return t('exercises.apex.speed', { speed: Math.round(corner.speedMps * KPH_PER_MPS), reference: Math.round(corner.apexSpeedMps * KPH_PER_MPS) });
}

export function sizeText(value: number, unit: Difference['unit']): string {
  return unit === 'm/s' ? t('app.unit.kph', { value: Math.round(value * KPH_PER_MPS) }) : metres(value);
}

export function differenceName(kind: Difference['kind']): string {
  return t(`exercises.difference.${kind}`);
}

export function differenceText(difference: Difference): string {
  if (difference.kind === 'wide-apex') return t('exercises.difference.text.wide-apex', { metres: difference.size.toFixed(1) });
  return t(`exercises.difference.text.${difference.kind}`, { amount: sizeText(difference.size, difference.unit) });
}

export function recurringText(recurring: RecurringDifference): string {
  return t('exercises.difference.recurring', { name: differenceName(recurring.kind), count: recurring.count, of: recurring.of, size: sizeText(recurring.medianSize, recurring.unit) });
}

export function recurringPlaceText(recurring: RecurringDifference): string {
  return t('exercises.difference.recurring-place', { name: differenceName(recurring.kind), metres: Math.round(recurring.sM), size: sizeText(recurring.medianSize, recurring.unit) });
}
