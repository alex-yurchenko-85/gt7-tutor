import type { ExerciseStatusName } from '@gt7/contracts';
import { t } from '../../app/i18n.ts';
import { CIRCUIT_EXPERIENCE } from '../exercise/use-exercise-where.ts';

export function statusLabel(status: ExerciseStatusName): string | null {
  return status === 'practising' ? null : t(`exercises.status.${status}`);
}

const FAMILY_ORDER = ['Licence', CIRCUIT_EXPERIENCE, 'Brand Central'];

export function orderedFamilies(families: string[]): string[] {
  const present = new Set(families);
  const extra = [...present].filter(family => !FAMILY_ORDER.includes(family)).sort((a, b) => a.localeCompare(b));
  return [...FAMILY_ORDER.filter(family => present.has(family)), ...extra];
}
