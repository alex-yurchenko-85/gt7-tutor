import type { ExerciseStatusName, ExerciseStep } from '@gt7/contracts';
import { t } from '../../app/i18n.ts';

export function statusLabel(status: ExerciseStatusName): string {
  return t(`exercises.status.${status}`);
}

const FAMILY_ORDER = ['Licence', 'Circuit Experience', 'Brand Central'];

export function orderedFamilies(families: string[]): string[] {
  const present = new Set(families);
  const extra = [...present].filter(family => !FAMILY_ORDER.includes(family)).sort((a, b) => a.localeCompare(b));
  return [...FAMILY_ORDER.filter(family => present.has(family)), ...extra];
}

export function nextTitle(step: ExerciseStep): string {
  return t(`exercises.next.${step}`);
}
