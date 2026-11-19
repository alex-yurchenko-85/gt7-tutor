import type { Exercise, ExerciseStatusName, ExerciseStep, MedalName } from '@gt7/contracts';
import { paths } from '../../app/router.tsx';

export type Action = { label: string; to: string };

export type MedalGap = { medal: MedalName; targetMs: number; gapMs: number };

const MEDALS: { medal: MedalName; target: 'bronzeMs' | 'silverMs' | 'goldMs' }[] = [
  { medal: 'bronze', target: 'bronzeMs' },
  { medal: 'silver', target: 'silverMs' },
  { medal: 'gold', target: 'goldMs' }
];

const NEXT_STEP: Record<ExerciseStep, string> = {
  1: 'record the reference',
  2: 'baseline attempts',
  3: 'guided attempt',
  4: 'review'
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
  { step: 2, label: 'Baseline' },
  { step: 3, label: 'Guided' },
  { step: 4, label: 'Review' }
];

const FAMILY_ORDER = ['Licence', 'Circuit Experience', 'Brand Central'];

export function orderedFamilies(families: string[]): string[] {
  const extra = [...new Set(families.filter(family => !FAMILY_ORDER.includes(family)))].sort((a, b) => a.localeCompare(b));
  return [...FAMILY_ORDER, ...extra];
}

export function nextStepText(exercise: Exercise): string {
  return exercise.status === 'gold' ? 'none, done' : NEXT_STEP[exercise.step];
}

export function medalGap(exercise: Exercise): MedalGap | null {
  if (exercise.bestMs === null || exercise.status === 'gold') return null;
  const bestMs = exercise.bestMs;
  for (const { medal, target } of MEDALS) {
    const targetMs = exercise.targets[target];
    if (targetMs !== undefined && bestMs > targetMs) return { medal, targetMs, gapMs: bestMs - targetMs };
  }
  return null;
}

export function primaryAction(exercise: Exercise): Action {
  switch (exercise.step) {
    case 1:
      return { label: 'Record the reference', to: paths.record(exercise.id) };
    case 2:
      return { label: 'Start a baseline attempt', to: paths.drive('baseline') };
    case 3:
      return { label: 'Start a guided attempt', to: paths.drive('guided') };
    case 4:
      return { label: 'Open the attempts', to: paths.attempts(exercise.id) };
  }
}
