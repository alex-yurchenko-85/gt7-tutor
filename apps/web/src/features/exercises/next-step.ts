import type { Exercise, ExerciseStatusName, ExerciseStep } from '@gt7/contracts';
import { paths } from '../../app/router.tsx';

export type Action = { label: string; to: string };

const NEXT_STEP: Record<ExerciseStep, string> = {
  1: 'record the reference',
  2: 'attempt',
  3: 'review'
};

export const STATUS_LABEL: Record<ExerciseStatusName, string> = {
  new: 'New',
  ready: 'Ready',
  practising: 'Practising',
  bronze: 'Bronze',
  silver: 'Silver',
  gold: 'Gold'
};

export const STEP_LABELS: { step: ExerciseStep; label: string }[] = [
  { step: 1, label: 'Reference' },
  { step: 2, label: 'Attempts' },
  { step: 3, label: 'Review' }
];

const FAMILY_ORDER = ['Licence', 'Circuit Experience', 'Brand Central'];

export function orderedFamilies(families: string[]): string[] {
  const extra = [...new Set(families.filter(family => !FAMILY_ORDER.includes(family)))].sort((a, b) => a.localeCompare(b));
  return [...FAMILY_ORDER, ...extra];
}

export function nextStepText(exercise: Exercise): string {
  return exercise.status === 'gold' ? 'none, done' : NEXT_STEP[exercise.step];
}

export function primaryAction(exercise: Exercise): Action {
  switch (exercise.step) {
    case 1:
      return { label: 'Record the reference', to: paths.record(exercise.id) };
    case 2:
      return { label: 'Start an attempt', to: paths.drive() };
    case 3:
      return { label: 'Open the attempts', to: paths.attempts(exercise.id) };
  }
}
