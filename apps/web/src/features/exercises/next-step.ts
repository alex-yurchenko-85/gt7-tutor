import type { Exercise, ExerciseStatusName } from '@gt7/contracts';
import { t } from '../../app/i18n.ts';
import { CIRCUIT_EXPERIENCE } from '../exercise/use-exercise-where.ts';

export function statusLabel(status: ExerciseStatusName): string | null {
  return status === 'practising' ? null : t(`exercises.status.${status}`);
}

export function orderedExercises(exercises: Exercise[], catalogueIds: string[]): Exercise[] {
  const position = new Map(catalogueIds.map((id, index) => [id, index]));
  const rank = (exercise: Exercise) => (exercise.catalogueId === null ? undefined : position.get(exercise.catalogueId));
  return [...exercises].sort((a, b) => {
    const left = rank(a);
    const right = rank(b);
    if (left !== undefined && right !== undefined) return left - right;
    if (left !== undefined) return -1;
    if (right !== undefined) return 1;
    return a.createdAt.localeCompare(b.createdAt);
  });
}

const FAMILY_ORDER = ['Licence', CIRCUIT_EXPERIENCE, 'Brand Central'];

export function orderedFamilies(families: string[]): string[] {
  const present = new Set(families);
  const extra = [...present].filter(family => !FAMILY_ORDER.includes(family)).sort((a, b) => a.localeCompare(b));
  return [...FAMILY_ORDER.filter(family => present.has(family)), ...extra];
}
